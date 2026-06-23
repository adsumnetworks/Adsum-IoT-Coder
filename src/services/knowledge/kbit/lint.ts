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

	// R4.3 — LICENSE FOLLOWS DELIVERY (K-bit Licensing & Delivery Policy). A `bundled` bit ships in the
	// Apache VSIX as plaintext, so it MUST be open (CC-BY-SA-4.0) — proprietary content must never ship
	// bundled; make it `delivery: downloaded` (registry-served, copyright). `downloaded` bits default to
	// proprietary; an open downloaded bit is allowed but flagged to confirm intent.
	if (meta.delivery === "bundled" && meta.license !== "CC-BY-SA-4.0") {
		issues.push({
			level: "error",
			file: relPath,
			msg: `bundled bit must be open (CC-BY-SA-4.0) — found "${meta.license}". A bundled bit ships in the Apache VSIX as plaintext; proprietary content must be \`delivery: downloaded\` (registry-served). License follows delivery.`,
		})
	}
	if (meta.delivery === "downloaded" && meta.license === "CC-BY-SA-4.0") {
		issues.push({
			level: "warn",
			file: relPath,
			msg: `downloaded bit is open (CC-BY-SA-4.0) — downloaded bits default to LicenseRef-Adsum-Proprietary; confirm this open licence is intentional.`,
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
