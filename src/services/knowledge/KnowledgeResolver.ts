import { existsSync, readdirSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { HostProvider } from "@/hosts/host-provider"
import { creditFieldsFromYaml, creditFromMeta, type KbitCredit, type KbitMetaLike } from "@/services/knowledge/kbit/credit"
import { extractFrontmatter, stripFrontmatter } from "@/services/knowledge/kbit/frontmatter"
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

/**
 * Pure: build an id → manifest-entry map from manifest.json text.
 *
 * Keeps the WHOLE entry, not just the path: the manifest already carries every attribution fact the
 * credit UI needs (title/type/author/version/license/platform) and dropping them here was the only reason
 * the product could not credit its own authors.
 */
export function indexManifest(jsonText: string): Map<string, ManifestEntry> {
	const map = new Map<string, ManifestEntry>()
	const data = JSON.parse(jsonText) as { bits?: ManifestEntry[] }
	for (const bit of data.bits ?? []) {
		if (bit?.id && bit.path) {
			map.set(bit.id, bit)
		}
	}
	return map
}

export type ManifestEntry = KbitMetaLike & { id: string; path: string }

let asyncCache: Map<string, ManifestEntry> | null = null
let syncCache: Map<string, ManifestEntry> | null = null

async function manifest(): Promise<Map<string, ManifestEntry>> {
	if (asyncCache) {
		return asyncCache
	}
	let map = new Map<string, ManifestEntry>()
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

function manifestSyncMap(): Map<string, ManifestEntry> {
	if (syncCache) {
		return syncCache
	}
	let map = new Map<string, ManifestEntry>()
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
	const rel = (await manifest()).get(id)?.path
	return rel ? path.join(knowledgeRoot(), rel) : null
}

/** Synchronous absolute path for a bit id, or null if unknown (for sync callers, e.g. the demo builder). */
export function resolveBitPathSync(id: string): string | null {
	const rel = manifestSyncMap().get(id)?.path
	return rel ? path.join(knowledgeRoot(), rel) : null
}

// ── Attribution (design/01) ─────────────────────────────────────────────────────
// Loads are recorded here as they resolve so the tool handler can credit the bit AFTER it knows the load
// succeeded. A side registry rather than a widened return type: every loader returns the bit body as a
// plain string and threading a tuple through all of them would touch far more code than it earns.
// Bounded by the corpus size (one entry per distinct bit ever loaded this session).
const creditById = new Map<string, KbitCredit>()

function recordCredit(id: string, meta: KbitMetaLike): void {
	if (id) {
		creditById.set(id, creditFromMeta(meta, id))
	}
}

/** Record credit from a bit's own frontmatter — LOCAL/dev overrides only.
 *  Registry-served bits must use recordCredit(entry) instead: the publisher strips frontmatter before
 *  hashing the body, so a downloaded blob has none to read. */
function recordCreditFromText(id: string, text: string): void {
	const fm = extractFrontmatter(text)
	recordCredit(id, fm.found && fm.closed ? creditFieldsFromYaml(fm.yaml) : {})
}

/** Attribution facts for a bit that resolved this session, or null if it never loaded. */
export function creditFor(id: string): KbitCredit | null {
	return creditById.get(id) ?? null
}

/** Attribution facts for a bundled-tree absolute path (the shape the read tool works in). */
export async function creditForKbPath(absPath: string): Promise<KbitCredit | null> {
	const id = bitIdForKbPath(absPath)
	if (!id) {
		return null
	}
	const known = creditById.get(id)
	if (known) {
		return known
	}
	// A bundled bit read straight off disk never goes through loadBit(), so derive from the manifest here.
	const entry = (await manifest()).get(id)
	if (entry) {
		recordCredit(id, entry)
		return creditById.get(id) ?? null
	}
	return null
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
	/** Fired when the CRA Readiness Check workflow loads — the H1 acquisition signal for the CRA feature. */
	craCheckStarted?(): void
}
/** The CRA Readiness Check workflow id — loading it means a CRA check is running (telemetry signal). */
const CRA_WORKFLOW_ID = "adsum/cra/workflows/cra-readiness"

/**
 * In-session flag: set when the CRA workflow loads, consumed (read + cleared) when the NEXT task starts.
 * It is the host-side bridge for `core_feature_tried_after_cra` — the routed debug/addFeature task is a
 * separate task started via the webview-only `runIntent`, which has no telemetry path, so the host reads
 * this flag at `Controller.initTask`. In-memory on purpose: the signal is "continued use *this session*
 * after a CRA run", and it must not persist across a reload. Fires only for the first task after the run.
 */
let craRanThisSession = false
/** Read-and-clear the "a CRA run happened this session" flag (host-side `core_feature_tried_after_cra`). */
export function consumeCraRanThisSession(): boolean {
	const v = craRanThisSession
	craRanThisSession = false
	return v
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

// ── Dev override: local-disk resolution for downloaded bits ──────────────────────
//
// `ADSUM_KBIT_LOCAL=<abs path to a kbits/ tree>` (e.g. ../Adsum-Backend/kbits) lets a developer F5-test
// a DOWNLOADED (closed/proprietary) bit straight from disk — edit + F5, same friction as a bundled bit —
// before it's ever published to the registry. Without it, testing a closed bit needs the copy-into-
// iot-knowledge/ trick (easy to forget to undo → proprietary leak in a VSIX).
//
// Hard-gated on `process.env.IS_DEV === "true"`. esbuild defines IS_DEV as the literal "false" in every
// production build (esbuild.mjs), so this whole branch is dead-code-eliminated from a shipped VSIX even
// if the env var is somehow present on the machine. Only affects ids NOT in the bundled manifest.

let localKbitIndex: Map<string, string> | null | undefined // undefined = not built yet; null = disabled

/** The local kbits root, or null unless BOTH the env var is set AND this is a dev build. */
function localKbitDir(): string | null {
	if (process.env.IS_DEV !== "true") {
		return null
	}
	const dir = process.env.ADSUM_KBIT_LOCAL
	return dir && existsSync(dir) ? dir : null
}

/** Lazy id → absolute-path index over the local kbits tree, using the same deriveId as the bundled manifest. */
function localKbits(): Map<string, string> | null {
	if (localKbitIndex !== undefined) {
		return localKbitIndex
	}
	const root = localKbitDir()
	if (!root) {
		localKbitIndex = null
		return null
	}
	const map = new Map<string, string>()
	try {
		for (const f of readdirSync(root, { recursive: true }) as string[]) {
			if (!f.endsWith(".md")) {
				continue
			}
			const rel = f.replace(/\\/g, "/")
			map.set(deriveIdFromRel(rel), path.join(root, f))
		}
		console.info(`[kbit] local override active (${map.size} bits) ← ${root}`)
	} catch (e) {
		console.error("KnowledgeResolver: failed to index ADSUM_KBIT_LOCAL", e)
	}
	localKbitIndex = map
	return map
}

/** Load a downloaded (non-bundled) bit: local override (dev) → verified cache → fetch (verify, cache if open) → "". */
async function loadDownloadedBit(id: string): Promise<string> {
	const localPath = localKbits()?.get(id)
	if (localPath) {
		try {
			console.info(`[kbit] ${id} ← local override`)
			const text = readFileSync(localPath, "utf-8")
			recordCreditFromText(id, text)
			return stripFrontmatter(text)
		} catch (e) {
			console.error(`KnowledgeResolver: failed to read local-override bit "${id}"`, e)
		}
	}
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
		console.info(`[kbit] ${id} ← registry (cache)`)
		recordCredit(id, entry)
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
		const open = isOpenLicense(entry.license)
		if (open) {
			await cache().writeBlob(hash, fetched)
		}
		kbitTelemetry.downloadedResolved?.({ id, source: "registry" })
		console.info(`[kbit] ${id} ← registry (fetched${open ? ", cached" : ", proprietary — not cached"})`)
		recordCredit(id, entry)
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
	if (id === CRA_WORKFLOW_ID) {
		kbitTelemetry.craCheckStarted?.()
		craRanThisSession = true // arm the cross-task "core feature tried after CRA" signal (consumed at next task start)
	}
	const full = await resolveBitPath(id) // bundled manifest only
	if (full) {
		try {
			if (await fileExistsAtPath(full)) {
				console.info(`[kbit] ${id} ← bundled`)
				const entry = (await manifest()).get(id)
				if (entry) {
					recordCredit(id, entry)
				}
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

/** The bit id for an absolute `iot-knowledge/…` path (same parsing as loadBitByKbPath), or null. */
export function bitIdForKbPath(absPath: string): string | null {
	const marker = `/${KNOWLEDGE_DIR}/`
	const norm = absPath.replace(/\\/g, "/")
	const i = norm.lastIndexOf(marker)
	if (i === -1) {
		return null
	}
	const rel = norm.slice(i + marker.length)
	if (!rel || rel.startsWith("..")) {
		return null
	}
	return deriveIdFromRel(rel)
}

/**
 * True if the id is listed in the downloaded catalog (manifest). Used for precise read-error attribution:
 * "listed but the blob fetch failed" (transient — retry) is a different failure from "not in the registry
 * at all" (wrong path / unpublished) — a real Windows field report got the misleading "not found" wording
 * for what was likely a transient blob failure, because the error branch only re-checked manifest
 * reachability.
 */
export async function downloadedBitKnown(id: string): Promise<boolean> {
	return (await downloadedManifest()).has(id)
}

/** Display rel path for a bit id — inverse of deriveIdFromRel (platform ids regain the `platforms/` prefix). */
export function relPathForId(id: string): string {
	const rest = id.replace(/^adsum\//, "")
	return `${/^(nrf|esp)\//.test(rest) ? "platforms/" : ""}${rest}.md`
}

/**
 * Pure near-miss ranking for a mistyped bit path. The observed failure class is "right filename, wrong
 * directory" — a real run guessed `cra/rules/core.md` for `cra/core.md` (pattern-matched from the rule-bit
 * siblings), got an honest "not found" twice, and dead-ended the whole CRA run. Only ids whose LAST segment
 * matches the requested basename are suggested (near-zero false positives); ties rank by how many directory
 * segments they share with the wrong guess.
 */
export function rankNearMissIds(requestedRel: string, ids: string[], max = 3): string[] {
	const rel = requestedRel.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()
	const base = rel.split("/").pop()?.replace(/\.md$/, "")
	if (!base) {
		return []
	}
	const reqSegs = new Set(rel.replace(/\.md$/, "").split("/"))
	return ids
		.filter((id) => id.split("/").pop() === base)
		.map((id) => ({
			id,
			overlap: id
				.replace(/^adsum\//, "")
				.split("/")
				.filter((s) => reqSegs.has(s)).length,
		}))
		.sort((a, b) => b.overlap - a.overlap)
		.slice(0, max)
		.map((x) => relPathForId(x.id))
}

/** Near-miss bit paths for a wrong `read_file` guess, from the union of the bundled + downloaded catalogs. */
export async function suggestNearMissBits(requestedRelOrAbs: string): Promise<string[]> {
	try {
		const norm = requestedRelOrAbs.replace(/\\/g, "/")
		const marker = `/${KNOWLEDGE_DIR}/`
		const i = norm.lastIndexOf(marker)
		const rel = i === -1 ? norm : norm.slice(i + marker.length)
		const ids = new Set<string>()
		for (const k of (await manifest()).keys()) {
			ids.add(k)
		}
		for (const k of (await downloadedManifest()).keys()) {
			ids.add(k)
		}
		return rankNearMissIds(rel, [...ids])
	} catch {
		return [] // suggestions are best-effort — never turn a not-found into a crash
	}
}

/**
 * Top-level dirs under `iot-knowledge/` whose files are bits. Used to recognise a bundled-tree
 * RELATIVE path (no `iot-knowledge/` prefix) so ordinary missing project files fall through.
 */
const BIT_ROOTS = ["platforms/", "cra/", "rules/"]

/** True if `rel` looks like a bundled-tree relative path to a bit (e.g. `platforms/nrf/…/x.md`). */
export function isBareBitPath(rel: string | undefined | null): boolean {
	if (!rel) {
		return false
	}
	const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "")
	return /\.md$/i.test(norm) && BIT_ROOTS.some((r) => norm.startsWith(r))
}

/**
 * Resolve a bundled-tree RELATIVE path (no `iot-knowledge/` prefix) to its bit content. The agent
 * often reads a bit by its tree path, e.g. `platforms/nrf/workflows/debug-loop.md`; that resolves
 * against the workspace and isn't on disk, so without this it 404s and the agent retries with the
 * absolute path. Restricted to known bit roots so ordinary missing files (`src/main.c`) return null
 * fast (no registry hit). Resolves through `loadBit` (bundled → cache → fetch, hash-verified).
 */
export async function loadBitByRel(rel: string): Promise<string | null> {
	if (!isBareBitPath(rel)) {
		return null
	}
	const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "")
	const body = await loadBit(deriveIdFromRel(norm))
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
	localKbitIndex = undefined
}
