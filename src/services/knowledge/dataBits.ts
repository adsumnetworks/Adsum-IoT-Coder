import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { load as yamlLoad } from "js-yaml"
import { HostProvider } from "@/hosts/host-provider"
import { bitCacheDir, deriveIdFromRel } from "@/services/knowledge/KnowledgeResolver"
import { sha256 } from "@/services/knowledge/registry/BitCache"
import { stripFrontmatter } from "@/services/knowledge/kbit/frontmatter"

/**
 * Read a bit's YAML table SYNCHRONOUSLY, for the one caller that cannot await: activation.
 *
 * Some knowledge is a lookup table, not prose — PCA number to board name, chip id to architecture.
 * It belongs in a bit because it changes when a vendor ships a part, which is far more often than we
 * ship a VSIX; a name table should never need a reinstall. But the code that needs it runs while the
 * prompt is being assembled, before any agent exists to `read_file` it.
 *
 * So: fs only, never the network. The registry copy is read from the on-disk cache if a previous
 * session already fetched it and it still verifies; otherwise the bundled copy, which always exists.
 * Activation must not wait on a fetch, and must not fail because a cache entry is corrupt — every
 * failure here falls through to the bundled floor, silently.
 */

type TableCache = { table: unknown; source: "registry" | "bundled" }
const cache = new Map<string, TableCache>()

/** The first fenced ```yaml block in a bit body. Fenced, so it cannot be confused with prose. */
export function parseYamlBlock(body: string): unknown {
	const m = /```ya?ml\r?\n([\s\S]*?)```/.exec(body)
	if (!m) {
		return null
	}
	try {
		return yamlLoad(m[1])
	} catch {
		return null
	}
}

/**
 * The registry copy of `id`, read straight off the cache with its hash verified — or null.
 *
 * `BitCache` is promises-only and keyed by content hash, so this cannot reuse it. It reads the same
 * two files the async path does, synchronously, and verifies the same way: a blob whose bytes do not
 * match the manifest's hash is treated as absent, exactly as the async reader treats it.
 */
function registryCopySync(id: string): string | null {
	let dir: string
	try {
		dir = bitCacheDir()
	} catch {
		// HostProvider is not up yet. Activation ordering is not something a lookup table gets to
		// depend on, so this is a normal outcome, not an error.
		return null
	}
	try {
		const manifestPath = path.join(dir, "manifest.json")
		if (!existsSync(manifestPath)) {
			return null
		}
		const bits = (JSON.parse(readFileSync(manifestPath, "utf8")) as { bits?: Array<Record<string, unknown>> }).bits ?? []
		const row = bits.find((b) => b.id === id)
		const hash = typeof row?.content_hash === "string" ? row.content_hash : null
		if (!hash) {
			return null
		}
		const blob = path.join(dir, "blobs", `${hash}.md`)
		if (!existsSync(blob)) {
			return null // proprietary bits are never written to disk; open ones may simply not be cached yet
		}
		const text = readFileSync(blob, "utf8")
		return sha256(text) === hash ? text : null
	} catch {
		return null
	}
}

/** The bundled copy of a bit, by id. Always present for a data bit — it is the floor. */
function bundledCopy(id: string, relPath: string): string | null {
	try {
		const abs = path.join(HostProvider.get().extensionFsPath, "iot-knowledge", relPath)
		return existsSync(abs) ? readFileSync(abs, "utf8") : null
	} catch {
		return null
	}
}

/**
 * The YAML table a data bit carries, preferring a verified registry copy over the bundled one.
 *
 * `relPath` is the bundled path, needed because the sync manifest index is not available this early.
 * The id is derived from it and checked, so the two cannot drift apart unnoticed.
 */
export function readDataBitTable(relPath: string): { table: unknown; source: "registry" | "bundled" } | null {
	const id = deriveIdFromRel(relPath)
	const hit = cache.get(id)
	if (hit) {
		return hit
	}
	for (const [source, text] of [
		["registry", registryCopySync(id)],
		["bundled", bundledCopy(id, relPath)],
	] as const) {
		if (!text) {
			continue
		}
		const table = parseYamlBlock(source === "registry" ? text : stripFrontmatter(text))
		if (table) {
			const entry = { table, source } as TableCache
			cache.set(id, entry)
			return entry
		}
		// Parsed to nothing: an edit that broke the block. Fall through to the next copy rather than
		// serving an empty table, which would silently un-name every board.
	}
	return null
}

/** Test seam: forget what has been read, so a test can change the files underneath. */
export function __resetDataBitCache(): void {
	cache.clear()
}

// ── board identity ───────────────────────────────────────────────────────────

const BOARD_IDENTITY_REL = "platforms/nrf/knowledge/board-identity.md"

/**
 * PCA number → the board name a developer recognises.
 *
 * Returns an empty map only if both copies are unreadable, in which case callers show the raw PCA —
 * which is what they showed before this table existed, so the failure mode is the old behaviour
 * rather than a blank.
 */
export function boardNames(): Map<string, string> {
	const read = readDataBitTable(BOARD_IDENTITY_REL)
	const rows = (read?.table as { boards?: Array<{ pca?: unknown; name?: unknown }> } | null)?.boards
	const out = new Map<string, string>()
	if (!Array.isArray(rows)) {
		return out
	}
	for (const r of rows) {
		if (typeof r?.pca === "string" && typeof r?.name === "string") {
			out.set(r.pca.toUpperCase(), r.name)
		}
	}
	return out
}

/** The friendly name for a PCA number, or undefined when the table does not know it. */
export function boardNameFor(pca: string | undefined): string | undefined {
	return pca ? boardNames().get(pca.toUpperCase()) : undefined
}
