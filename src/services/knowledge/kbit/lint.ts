import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { load as yamlLoad } from "js-yaml"
import { extractFrontmatter } from "./frontmatter"
import { type KBitSafety, kbitMetaSchema } from "./schema"

export { extractFrontmatter, type Frontmatter } from "./frontmatter"

/**
 * Pure K-bit linting logic — see iot-knowledge/KBIT-SPEC.md.
 * The CLI wrapper (scripts/kbit-lint.ts) does the IO + exit code; everything here is
 * importable + unit-testable (and reused by the authoring wizard in P1).
 */

export type Issue = { level: "error" | "warn"; file: string; msg: string }

/** Files that live under iot-knowledge/ but are not themselves bits. */
export const NON_BIT_FILES = new Set(["KBIT-SPEC.md"])

/** Path (relative to iot-knowledge/) → canonical bit id. Must match a migrated bit's `id`. */
export function deriveId(relPath: string): string {
	const p = relPath
		.replace(/\\/g, "/")
		.replace(/^platforms\//, "")
		.replace(/\.md$/i, "")
		.toLowerCase()
	return `adsum/${p}`
}

/** Dangerous-op markers → the `safety` tag they require. Best-effort (the obvious commands). */
const SAFETY_PATTERNS: { tag: KBitSafety; re: RegExp }[] = [
	{ tag: "flash", re: /\bwest\s+flash\b|\bnrfutil\s+device\s+program\b|\bnrfjprog\b[^\n]*--program/i },
	{ tag: "erase", re: /--erase\b|\bnrfjprog\b[^\n]*--erase/i },
	{ tag: "process-kill", re: /\bpkill\b|\btaskkill\b|\bkill\s+-9\b/i },
]

/** The set of dangerous-op tags detected in a bit body. */
export function detectSafety(body: string): Set<KBitSafety> {
	const found = new Set<KBitSafety>()
	for (const { tag, re } of SAFETY_PATTERNS) {
		if (re.test(body)) {
			found.add(tag)
		}
	}
	return found
}

/**
 * Lint a single bit from its content (pure — no filesystem).
 * `knownIds` is the set of all derivable bit ids (so `requires` can resolve to as-yet-unmigrated bits).
 */
export function lintBitContent(relPath: string, text: string, knownIds: Set<string>): Issue[] {
	const issues: Issue[] = []
	const fm = extractFrontmatter(text)

	if (!fm.found) {
		issues.push({ level: "warn", file: relPath, msg: "no frontmatter (unmigrated — migrate in P0b)" })
		return issues
	}
	if (!fm.closed) {
		issues.push({ level: "error", file: relPath, msg: "frontmatter opened with `---` but never closed" })
		return issues
	}

	let parsed: unknown
	try {
		parsed = yamlLoad(fm.yaml)
	} catch (e) {
		issues.push({ level: "error", file: relPath, msg: `invalid YAML frontmatter: ${(e as Error).message}` })
		return issues
	}

	const result = kbitMetaSchema.safeParse(parsed)
	if (!result.success) {
		for (const issue of result.error.issues) {
			const where = issue.path.length ? issue.path.join(".") : "(root)"
			issues.push({ level: "error", file: relPath, msg: `schema: ${where}: ${issue.message}` })
		}
		return issues
	}

	const meta = result.data
	const derived = deriveId(relPath)
	if (meta.id !== derived) {
		issues.push({ level: "error", file: relPath, msg: `id "${meta.id}" does not match path-derived id "${derived}"` })
	}

	const refs = [...(meta.requires ?? []), ...(meta.loaded_by ?? []), ...(meta.supersedes ? [meta.supersedes] : [])]
	for (const ref of refs) {
		if (!knownIds.has(ref)) {
			issues.push({ level: "error", file: relPath, msg: `unresolved bit reference: "${ref}"` })
		}
	}

	const declared = new Set(meta.safety ?? [])
	for (const tag of detectSafety(fm.body)) {
		if (!declared.has(tag)) {
			issues.push({ level: "error", file: relPath, msg: `body performs a "${tag}" op but \`safety\` does not declare it` })
		}
	}

	const h1 = fm.body.split(/\r?\n/).find((l) => l.startsWith("# "))
	const base = relPath.split("/").pop() ?? relPath
	if (!h1 || !h1.includes(base)) {
		issues.push({ level: "warn", file: relPath, msg: `H1 should name its own path (e.g. "(… /${base})")` })
	}

	// R5.2 — endorsements are version-pinned: a stale endorsement (for an older version) must be re-earned.
	for (const e of meta.endorsers ?? []) {
		if (e.version !== meta.version) {
			issues.push({
				level: "warn",
				file: relPath,
				msg: `endorsement by "${e.handle}" is for v${e.version} but the bit is v${meta.version} — bump or re-endorse`,
			})
		}
	}

	// R4.1 — bundled bits are frozen to the app release; they can't be independently deprecated/revoked.
	if (meta.delivery === "bundled" && (meta.status === "deprecated" || meta.status === "revoked")) {
		issues.push({
			level: "warn",
			file: relPath,
			msg: `status "${meta.status}" on a bundled bit can't be enforced independently — revocation needs the registry (downloaded delivery)`,
		})
	}

	return issues
}

/** List the bit (.md) files under a knowledge root, relative + posix, excluding non-bit files. */
export function listBitFiles(knowledgeRoot: string): string[] {
	return (readdirSync(knowledgeRoot, { recursive: true }) as string[])
		.map((f) => f.replace(/\\/g, "/"))
		.filter((f) => f.endsWith(".md") && !NON_BIT_FILES.has(f.split("/").pop() ?? f))
		.sort()
}

export type CorpusResult = { issues: Issue[]; files: string[]; migrated: number }

/** Lint the whole corpus under a knowledge root. */
export function lintCorpus(knowledgeRoot: string): CorpusResult {
	const files = listBitFiles(knowledgeRoot)
	const knownIds = new Set(files.map(deriveId))
	const issues: Issue[] = []
	for (const f of files) {
		const text = readFileSync(join(knowledgeRoot, f), "utf8")
		issues.push(...lintBitContent(f, text, knownIds))
	}
	const unmigrated = new Set(issues.filter((i) => i.msg.startsWith("no frontmatter")).map((i) => i.file))
	return { issues, files, migrated: files.length - unmigrated.size }
}

// ── Drift / version / mapping guards (the kbit dev-workflow safety nets) ──────────

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

export type ManifestEntry = { id: string; version: string; path: string; content_hash: string }

/** Tolerant parse of manifest.json text → bit entries. Returns [] on any malformed input. */
export function parseManifestEntries(jsonText: string): ManifestEntry[] {
	try {
		const obj = JSON.parse(jsonText)
		const bits = Array.isArray(obj?.bits) ? obj.bits : []
		return bits
			.filter((b: unknown): b is ManifestEntry => !!b && typeof (b as ManifestEntry).id === "string")
			.map((b: ManifestEntry) => ({ id: b.id, version: b.version, path: b.path, content_hash: b.content_hash }))
	} catch {
		return []
	}
}

/**
 * Guard: the committed `manifest.json` must match the bits on disk. A mismatch means a bit was added or
 * edited without `npm run gen:kbit-manifest` — the exact "the agent can't find my bit" hole. The
 * content_hash is over the body (frontmatter stripped), identical to gen-kbit-manifest.
 */
export function lintManifestFresh(knowledgeRoot: string, files: string[], manifestJson: string): Issue[] {
	const issues: Issue[] = []
	const entries = parseManifestEntries(manifestJson)
	const byPath = new Map(entries.map((e) => [e.path, e]))
	const onDisk = new Set<string>()
	for (const f of files) {
		const fm = extractFrontmatter(readFileSync(join(knowledgeRoot, f), "utf8"))
		if (!fm.found) {
			continue // unmigrated — already a separate warning
		}
		onDisk.add(f)
		const e = byPath.get(f)
		if (!e) {
			issues.push({ level: "error", file: f, msg: "not in manifest.json — run `npm run gen:kbit-manifest`" })
		} else if (e.content_hash !== sha256(fm.body)) {
			issues.push({ level: "error", file: f, msg: "manifest.json content_hash is stale — run `npm run gen:kbit-manifest`" })
		}
	}
	for (const e of entries) {
		if (!onDisk.has(e.path)) {
			issues.push({
				level: "error",
				file: "manifest.json",
				msg: `lists ${e.path}, not on disk — run \`npm run gen:kbit-manifest\``,
			})
		}
	}
	return issues
}

/** Read the `version` field out of a frontmatter YAML block, tolerant of malformed input. */
function bitVersion(yaml: string): string | undefined {
	try {
		const m = yamlLoad(yaml) as { version?: unknown }
		return typeof m?.version === "string" ? m.version : undefined
	} catch {
		return undefined
	}
}

/**
 * Guard: a body change must bump the bit's `version`. Compares the bit's current body against its
 * previous body (the CLI supplies git HEAD's text; null = new file). Body-based, not manifest-based, so
 * it stays correct even when the committed manifest is itself stale. Pure → unit-testable.
 */
export function lintVersionBump(rel: string, currentText: string, headText: string | null): Issue[] {
	if (headText == null) {
		return [] // new bit — no prior version to compare
	}
	const cur = extractFrontmatter(currentText)
	const head = extractFrontmatter(headText)
	if (!cur.found || !head.found) {
		return []
	}
	const cv = bitVersion(cur.yaml)
	const hv = bitVersion(head.yaml)
	if (cur.body.trim() !== head.body.trim() && cv && hv && cv === hv) {
		return [{ level: "error", file: rel, msg: `body changed but version stayed ${cv} — bump \`version\`` }]
	}
	return []
}

/** True for index/map bits (all-caps basename like PLATFORM/SDK/BLE, or README) — they ARE the maps. */
function isIndexBit(rel: string): boolean {
	return /(^|\/)([A-Z][A-Z0-9-]*|README)\.md$/.test(rel)
}

/**
 * Map/discovery warning: every non-index bit should be referenced (by path or filename) somewhere else
 * in the corpus — i.e. listed in a map/index so the agent learns it exists. An orphan is the "useful md
 * never loaded" bug. Warning, not error: the indexes are still being completed during migration.
 */
export function lintMapping(knowledgeRoot: string, files: string[]): Issue[] {
	const bodies = files.map((f) => ({ f, text: readFileSync(join(knowledgeRoot, f), "utf8") }))
	const issues: Issue[] = []
	for (const { f } of bodies) {
		if (isIndexBit(f)) {
			continue
		}
		const name = f.split("/").pop() ?? f
		const referenced = bodies.some((b) => b.f !== f && (b.text.includes(f) || b.text.includes(name)))
		if (!referenced) {
			issues.push({ level: "warn", file: f, msg: "not referenced in any map/index bit (agent may never discover it)" })
		}
	}
	return issues
}
