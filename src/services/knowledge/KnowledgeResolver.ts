import { existsSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { HostProvider } from "@/hosts/host-provider"
import { stripFrontmatter } from "@/services/knowledge/kbit/frontmatter"
import { BitCache, sha256 } from "@/services/knowledge/registry/BitCache"
import {
	type DownloadedManifest,
	type DownloadedManifestEntry,
	RegistryClient,
} from "@/services/knowledge/registry/RegistryClient"
import { fileExistsAtPath } from "@/utils/fs"

/**
 * KnowledgeResolver — resolves a K-bit by its stable `id` to its on-disk location/content.
 *
 * Resolve order (P2): **bundled → cache → fetch**.
 *  - Bundled bits come from `iot-knowledge/manifest.json` (id → path), shipped in the signed VSIX.
 *  - Downloaded bits come from the registry (RegistryClient) into an on-machine cache (BitCache),
 *    content-addressed and **hash-verified before use**. Bundled always wins on an id clash.
 *
 * Identity is the `id`, not the path (rename-safe). `loadBit()` strips frontmatter so a bit's YAML
 * metadata never enters the LLM prompt. Offline-safe: cache/fetch failures fall back, never throw.
 */

const KNOWLEDGE_DIR = "iot-knowledge"
const KBIT_CACHE_DIR_NAME = "kbit-cache"

/** Absolute path of the on-machine downloaded-bit cache (under globalStorage). */
export function bitCacheDir(): string {
	return path.join(HostProvider.get().globalStorageFsPath, KBIT_CACHE_DIR_NAME)
}

function knowledgeRoot(): string {
	return path.join(HostProvider.get().extensionFsPath, KNOWLEDGE_DIR)
}

/** Pure: build an id → relative-path map from manifest.json text. */
export function indexManifest(jsonText: string): Map<string, string> {
	const map = new Map<string, string>()
	const data = JSON.parse(jsonText) as { bits?: Array<{ id: string; path: string }> }
	for (const bit of data.bits ?? []) {
		map.set(bit.id, bit.path)
	}
	return map
}

let asyncCache: Map<string, string> | null = null
let syncCache: Map<string, string> | null = null

async function manifest(): Promise<Map<string, string>> {
	if (asyncCache) {
		return asyncCache
	}
	let map = new Map<string, string>()
	try {
		const manifestPath = path.join(knowledgeRoot(), "manifest.json")
		if (await fileExistsAtPath(manifestPath)) {
			map = indexManifest(await fs.readFile(manifestPath, "utf-8"))
		}
	} catch (e) {
		console.error("KnowledgeResolver: failed to load manifest.json", e)
	}
	asyncCache = map
	return map
}

function manifestSyncMap(): Map<string, string> {
	if (syncCache) {
		return syncCache
	}
	let map = new Map<string, string>()
	try {
		const manifestPath = path.join(knowledgeRoot(), "manifest.json")
		if (existsSync(manifestPath)) {
			map = indexManifest(readFileSync(manifestPath, "utf-8"))
		}
	} catch (e) {
		console.error("KnowledgeResolver: failed to load manifest.json (sync)", e)
	}
	syncCache = map
	return map
}

/** Absolute path for a bit id, or null if the id is unknown. */
export async function resolveBitPath(id: string): Promise<string | null> {
	const rel = (await manifest()).get(id)
	return rel ? path.join(knowledgeRoot(), rel) : null
}

/** Synchronous absolute path for a bit id, or null if unknown (for sync callers, e.g. the demo builder). */
export function resolveBitPathSync(id: string): string | null {
	const rel = manifestSyncMap().get(id)
	return rel ? path.join(knowledgeRoot(), rel) : null
}

// ── Downloaded tier (P2): registry + on-machine cache ───────────────────────────

let injectedCache: BitCache | null = null
let injectedRegistry: RegistryClient | null = null
let downloadedMap: Map<string, DownloadedManifestEntry> | null = null
// True once a fresh catalog fetch has succeeded this session. Until then a cache miss retries the
// fetch (handles "registry was down at session start, reachable later").
let manifestRevalidated = false

/** Optional telemetry sink for K-bit resolution. Wired by the extension at activation; a no-op in the
 *  CLI / node:test so this low-level module never imports telemetryService/HostProvider. */
type KbitTelemetry = {
	downloadedResolved?(p: { id: string; source: "cache" | "registry" }): void
	registryUnreachable?(p: { id?: string }): void
	cacheReconciled?(p: { purged: number }): void
}
let kbitTelemetry: KbitTelemetry = {}
export function __setKbitTelemetry(hooks: KbitTelemetry): void {
	kbitTelemetry = hooks ?? {}
}

function cache(): BitCache {
	return injectedCache ?? new BitCache(bitCacheDir())
}
function registry(): RegistryClient {
	return injectedRegistry ?? new RegistryClient()
}

/**
 * id → downloaded-manifest entry. **Revalidate-first:** fetch the current catalog once per session so
 * bit updates + removals (revocation) propagate, reconcile the on-disk cache against it, then fall back
 * to the last cached catalog when offline. (Cache-first would pin stale entries — an update or a
 * revocation would never reach a warm cache.)
 */
async function downloadedManifest(): Promise<Map<string, DownloadedManifestEntry>> {
	if (downloadedMap) {
		return downloadedMap
	}
	let manifestJson: string | null = null
	if (!manifestRevalidated) {
		const fetched = await registry().fetchManifest()
		if (fetched) {
			manifestRevalidated = true
			manifestJson = JSON.stringify(fetched)
			await cache().writeManifest(manifestJson)
			await reconcileCache(fetched)
		}
	}
	if (manifestJson === null) {
		manifestJson = await cache().readManifest() // offline → last known catalog
	}
	const map = new Map<string, DownloadedManifestEntry>()
	if (manifestJson) {
		try {
			for (const b of (JSON.parse(manifestJson) as DownloadedManifest).bits ?? []) {
				map.set(b.id, b)
			}
		} catch (e) {
			console.error("KnowledgeResolver: failed to parse downloaded manifest", e)
		}
	}
	downloadedMap = map
	return map
}

/** Purge cached blobs whose hash is no longer in the live catalog — honors revocation + frees superseded versions. */
async function reconcileCache(manifest: DownloadedManifest): Promise<void> {
	try {
		const live = new Set((manifest.bits ?? []).map((b) => b.content_hash))
		let purged = 0
		for (const hash of await cache().listBlobHashes()) {
			if (!live.has(hash)) {
				await cache().deleteBlob(hash)
				purged++
			}
		}
		if (purged > 0) {
			kbitTelemetry.cacheReconciled?.({ purged })
		}
	} catch (e) {
		console.error("KnowledgeResolver: cache reconcile failed", e)
	}
}

// Open content licenses — these may be cached on disk as plaintext (public content). Anything else
// (e.g. LicenseRef-Adsum-Proprietary) is treated as proprietary → NOT persisted to disk as plaintext
// until encrypt-at-rest + watermark lands (P5). Proprietary bits are served from the fetch, not cached.
const OPEN_LICENSE_RE = /^(CC-BY(-SA)?-4\.0|CC0-1\.0|Apache-2\.0|MIT|BSD-)/i
function isOpenLicense(license: unknown): boolean {
	return typeof license === "string" && OPEN_LICENSE_RE.test(license)
}

/** True if the registry is currently reachable (a fresh manifest fetch succeeds). Used for clear error messaging. */
export async function isRegistryReachable(): Promise<boolean> {
	return (await registry().fetchManifest()) !== null
}

/** Load a downloaded (non-bundled) bit: verified cache → fetch (verify, cache if open) → "". */
async function loadDownloadedBit(id: string): Promise<string> {
	let entry = (await downloadedManifest()).get(id)
	if (!entry && !manifestRevalidated) {
		// Catalog wasn't successfully revalidated yet (registry down at session start) and the id is
		// missing — drop the memo and retry, in case the registry is reachable now.
		downloadedMap = null
		entry = (await downloadedManifest()).get(id)
	}
	if (!entry) {
		console.error(`KnowledgeResolver: unknown bit id "${id}" (not bundled, not in registry)`)
		return ""
	}
	const { content_hash: hash } = entry
	const cached = await cache().readBlob(hash) // null if absent OR corrupt (hash mismatch)
	if (cached !== null) {
		kbitTelemetry.downloadedResolved?.({ id, source: "cache" })
		return stripFrontmatter(cached)
	}
	const fetched = await registry().fetchBlob(hash)
	if (fetched === null) {
		kbitTelemetry.registryUnreachable?.({ id })
		console.error(`KnowledgeResolver: could not load downloaded bit "${id}" (registry unreachable)`)
		return ""
	}
	if (sha256(fetched) === hash) {
		// Only persist OPEN bits to disk as plaintext. Proprietary bits are served from this fetch but
		// not cached (no on-disk plaintext) until encrypt-at-rest exists (P5).
		if (isOpenLicense(entry.license)) {
			await cache().writeBlob(hash, fetched)
		}
		kbitTelemetry.downloadedResolved?.({ id, source: "registry" })
		return stripFrontmatter(fetched)
	}
	console.error(`KnowledgeResolver: downloaded bit "${id}" failed hash verification`)
	return ""
}

/**
 * Bit body (frontmatter stripped) for a bit id; "" if unknown/unreadable (logged).
 * Order: **bundled → cache → fetch**. Bundled ids resolve exactly as before (zero regression);
 * only non-bundled ids reach the downloaded tier.
 */
export async function loadBit(id: string): Promise<string> {
	const full = await resolveBitPath(id) // bundled manifest only
	if (full) {
		try {
			if (await fileExistsAtPath(full)) {
				return stripFrontmatter(await fs.readFile(full, "utf-8"))
			}
		} catch (e) {
			console.error(`KnowledgeResolver: failed to read bit "${id}"`, e)
		}
		return ""
	}
	return loadDownloadedBit(id)
}

/** True if a bit id exists in the bundled manifest (sync-safe; does not hit the registry). */
export async function hasBit(id: string): Promise<boolean> {
	return (await manifest()).has(id)
}

// Mirror of deriveId() in kbit/lint.ts (kept dep-light here so the runtime doesn't bundle the linter).
export function deriveIdFromRel(rel: string): string {
	const p = rel
		.replace(/\\/g, "/")
		.replace(/^platforms\//, "")
		.replace(/\.md$/i, "")
		.toLowerCase()
	return `adsum/${p}`
}

/**
 * P2.5 — resolve an absolute `iot-knowledge/…` file path to its bit content via the registry.
 * Used by the read_file tool as a fallback when a bundled-tree path isn't on disk (an un-bundled
 * "downloaded" bit): maps path → id → loadBit (bundled → cache → fetch, hash-verified). Returns the
 * bit body, or null if the path isn't under iot-knowledge or the bit can't be resolved. This is what
 * lets the agent's on-demand `read_file <kbDir>/…/X.md` work for downloaded workflows/actions.
 */
export async function loadBitByKbPath(absPath: string): Promise<string | null> {
	const marker = `/${KNOWLEDGE_DIR}/`
	const norm = absPath.replace(/\\/g, "/")
	const i = norm.lastIndexOf(marker)
	if (i === -1) {
		return null // not under iot-knowledge/
	}
	const rel = norm.slice(i + marker.length)
	if (!rel || rel.startsWith("..")) {
		return null
	}
	const body = await loadBit(deriveIdFromRel(rel))
	return body || null
}

/** Test-only: inject cache/registry doubles for the downloaded tier (no network). */
export function __setRegistryHooks(hooks: { cache?: BitCache; registry?: RegistryClient }): void {
	injectedCache = hooks.cache ?? null
	injectedRegistry = hooks.registry ?? null
	downloadedMap = null
}

/** Test-only: clear the memoised manifests + downloaded tier. */
export function __resetManifestCache(): void {
	asyncCache = null
	syncCache = null
	downloadedMap = null
	manifestRevalidated = false
	injectedCache = null
	injectedRegistry = null
}
