import { existsSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { HostProvider } from "@/hosts/host-provider"
import { stripFrontmatter } from "@/services/knowledge/kbit/frontmatter"
import { fileExistsAtPath } from "@/utils/fs"

/**
 * KnowledgeResolver — resolves a K-bit by its stable `id` to its on-disk location/content,
 * using the generated `iot-knowledge/manifest.json` (id → path). This is the single seam
 * consumers use instead of hardcoding paths; in P2 it gains cache/fetch tiers for downloaded
 * bits (bundled → cache → fetch). Today it serves the bundled corpus only.
 *
 * Identity is the `id`, not the path (rename-safe). `loadBit()` strips frontmatter so a bit's
 * YAML metadata never enters the LLM prompt.
 */

const KNOWLEDGE_DIR = "iot-knowledge"

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

/** Bit body (frontmatter stripped) for a bit id; "" if unknown/unreadable (logged). */
export async function loadBit(id: string): Promise<string> {
	const full = await resolveBitPath(id)
	if (!full) {
		console.error(`KnowledgeResolver: unknown bit id "${id}" (not in manifest)`)
		return ""
	}
	try {
		if (await fileExistsAtPath(full)) {
			return stripFrontmatter(await fs.readFile(full, "utf-8"))
		}
	} catch (e) {
		console.error(`KnowledgeResolver: failed to read bit "${id}"`, e)
	}
	return ""
}

/** True if a bit id exists in the manifest. */
export async function hasBit(id: string): Promise<boolean> {
	return (await manifest()).has(id)
}

/** Test-only: clear the memoised manifests. */
export function __resetManifestCache(): void {
	asyncCache = null
	syncCache = null
}
