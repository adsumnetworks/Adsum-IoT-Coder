/**
 * Managed markdown blocks — how the host writes into a file a HUMAN also owns.
 *
 * Two files need this: the handover's `CLAUDE.md` / `AGENTS.md` (which the developer writes their own
 * rules into) and project memory's `.adsum/PROJECT.md` (which the developer is expected to correct by
 * hand — that is the whole point of putting memory in the workspace instead of globalStorage).
 *
 * Two rules govern it, both learned from real files:
 *
 *  1. We only ever touch text BETWEEN our markers. Everything around them survives verbatim.
 *  2. The begin marker carries a FINGERPRINT of the text WE last wrote. That makes the file
 *     self-describing: on the next write we can tell "unchanged since we wrote it" from "the developer
 *     edited inside our fence" while keeping no state on our side. When it no longer matches, we BACK
 *     OFF and report `skipped-user-edited` — a developer's words are never overwritten. This is
 *     deliberate: a corrected fact is worth more than a re-derived one.
 *
 * Extracted from `src/services/handover/HandoverBrief.ts` (which re-exports it, so the handover feature
 * is untouched) so project memory shares the exact mechanics rather than growing a second, subtly
 * different copy. The only addition is the optional `sectionId`, which lets ONE file hold several
 * independently-owned blocks; without it the markers are byte-identical to the original.
 */
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

export type BlockResult = "created" | "updated" | "unchanged" | "skipped-user-edited"

/** 12 hex of sha256 over the trimmed body — short enough to read in a marker, long enough not to collide. */
export const fingerprint = (s: string): string => createHash("sha256").update(s.trim()).digest("hex").slice(0, 12)

export const MANAGED_END = "<!-- adsum:managed:end -->"

/** The begin marker we write. With no `sectionId` this is exactly the original single-block marker. */
export function managedBeginMarker(fp: string, sectionId?: string): string {
	const id = sectionId ? `id=${sectionId} ` : ""
	return `<!-- adsum:managed:begin ${id}fp=${fp} — written by Adsum IoT Coder; edit outside this block -->`
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Matches OUR begin marker. The unscoped form deliberately refuses to match an id-scoped block, so a
 * multi-section file (PROJECT.md) can never be clobbered wholesale by an unscoped call.
 */
function beginRe(sectionId?: string): RegExp {
	return sectionId
		? new RegExp(`<!-- adsum:managed:begin id=${escapeRe(sectionId)} [^>]*-->`)
		: /<!-- adsum:managed:begin(?! id=)[^>]*-->/
}

/**
 * Write/refresh a managed block in a markdown file. Agent-agnostic and file-agnostic — which is what
 * makes it reusable for both CLAUDE.md and PROJECT.md.
 *
 * `sectionId` scopes the block so several sections can live in one file, each with its own ownership
 * and its own hand-edit detection.
 */
export function upsertManagedBlock(mdPath: string, body: string, sectionId?: string): BlockResult {
	const block = (b: string) => `${managedBeginMarker(fingerprint(b), sectionId)}\n${b}\n${MANAGED_END}`
	let existing = ""
	try {
		existing = fs.readFileSync(mdPath, "utf8")
	} catch {
		fs.mkdirSync(path.dirname(mdPath), { recursive: true })
		fs.writeFileSync(mdPath, block(body) + "\n")
		return "created"
	}
	const m = beginRe(sectionId).exec(existing)
	// Search for the terminator FROM our begin marker: with several blocks in one file, block 2's end
	// is not the file's first end marker.
	const e = m ? existing.indexOf(MANAGED_END, m.index) : -1
	if (!m || e === -1) {
		// No block of ours yet — append it, leaving everything the developer wrote untouched.
		fs.writeFileSync(mdPath, existing.trimEnd() + "\n\n" + block(body) + "\n")
		return "created"
	}
	const current = existing.slice(m.index + m[0].length, e).trim()
	if (current === body.trim()) {
		return "unchanged"
	}
	// The marker records the fingerprint of what we last wrote. If the block no longer matches it, a
	// human has edited inside our fence — leave their words alone and say so.
	const stamped = /fp=([0-9a-f]{12})/.exec(m[0])?.[1]
	if (stamped && stamped !== fingerprint(current)) {
		return "skipped-user-edited"
	}
	fs.writeFileSync(mdPath, existing.slice(0, m.index) + block(body) + existing.slice(e + MANAGED_END.length))
	return "updated"
}
