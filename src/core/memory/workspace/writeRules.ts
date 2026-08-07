/**
 * The rules that decide whether a model-authored memory write is allowed — and what it turns into.
 *
 * ZERO I/O, ZERO clock, ZERO HostProvider. Everything here is a total function of its arguments so
 * the decisions can be tested exhaustively without a workspace, a TaskConfig, or hardware
 * (`npm run test:memory-write`). The handler is left as a thin shell: parse params → decide here →
 * write through store.ts.
 *
 * Four defects this module exists to prevent, each one measured rather than imagined:
 *
 *  1. THE MODEL OVERWRITING HOST FACTS. The predecessor tool took `filename` + `content` and did a
 *     whole-file write, so a model could (and did) replace host-detected apps/hardware/toolchain
 *     with its own guesses. Those sections are now physically unreachable from this tool.
 *
 *  2. GOAL DRIFT. After a few hours inside one bug, a model asked to "update the goal" rewrites the
 *     PROJECT goal into a BUG-shaped goal ("get the UART ring buffer to stop dropping frames"),
 *     and the real objective — the thing the developer is actually paid to ship — is gone, with
 *     nothing left to notice its absence. Goal is therefore append-only history: setting a new goal
 *     pushes the old one onto priorGoals, never deletes it.
 *
 *  3. UNEVIDENCED DEFECTS. "BLE disconnects randomly" is not a defect record, it is a rumour: the
 *     next session cannot act on it and cannot check it. Every defect write must carry at least one
 *     `path:line` citation.
 *
 *  4. MEMORY AS A LOG SINK. Models paste capture output into memory, which then rides in the
 *     context of every future turn for that workspace. Memory holds the CONCLUSION plus a citation;
 *     the log body stays in the log file. The junk lint below enforces that deterministically (no
 *     model call, no heuristics that drift between providers) so it also works on small models.
 */
import { checkSectionWriteSize, SECTION_WRITE_CAPS } from "../memoryLimits"
import type { Defect, DefectState, StatusJson } from "./schema"

// ── the contract ─────────────────────────────────────────────────────────────────

export const MEMORY_TARGETS = ["goal", "hw-asserted", "note", "defect"] as const
export type MemoryTarget = (typeof MEMORY_TARGETS)[number]

export const MEMORY_OPS = ["set", "append", "close", "delete"] as const
export type MemoryOp = (typeof MEMORY_OPS)[number]

export interface MemoryWriteRequest {
	target?: string
	op?: string
	id?: string
	content?: string
}

export interface WriteAccepted {
	ok: true
	target: MemoryTarget
	op: MemoryOp
	/** Normalised to a slug for `note` and `defect`; left verbatim for `hw-asserted` (a serial/port). */
	id?: string
	content: string
}

export interface WriteRejected {
	ok: false
	reason: string
}

export type WriteDecision = WriteAccepted | WriteRejected

const reject = (reason: string): WriteRejected => ({ ok: false, reason })

/**
 * Which ops each target accepts. Deliberately narrow: an op that has no meaning for a target is a
 * rejection with an explanation, not a silent no-op the model never learns from.
 */
const ALLOWED_OPS: Record<MemoryTarget, MemoryOp[]> = {
	goal: ["set"],
	"hw-asserted": ["set", "append", "delete"],
	note: ["set", "append", "delete"],
	defect: ["set", "append", "close", "delete"],
}

/** Maps a target onto its size budget in memoryLimits.ts — no new numbers are invented here. */
export const CAP_SECTION: Record<MemoryTarget, string> = {
	goal: "goal",
	"hw-asserted": "hardware-asserted",
	note: "note",
	defect: "defect",
}

// ── host-owned sections ──────────────────────────────────────────────────────────

/**
 * Section names the model may never write, with the aliases models actually reach for. These are
 * re-derived from live detection on every task; a model-written copy would be a second, staler
 * truth that nothing can reconcile.
 */
export const HOST_OWNED_SECTIONS = [
	"apps",
	"app",
	"hw-detected",
	"hardware",
	"hardware-detected",
	"devices",
	"device",
	"toolchain",
	"env",
	"sdk",
	"map",
	"workspace-map",
] as const

export function hostOwnedName(name: string): string | undefined {
	const n = name.trim().toLowerCase()
	return (HOST_OWNED_SECTIONS as readonly string[]).includes(n) ? n : undefined
}

export function hostOwnedRejection(name: string): string {
	return (
		`Memory write rejected: '${name}' is host-owned. Apps, detected hardware, toolchain and the ` +
		`workspace map are written automatically from live detection on this machine — anything you wrote ` +
		`there would be a second, staler copy that nothing reconciles. If one of those facts is WRONG or ` +
		`missing, say so in your reply (name the fact and what you observed) and it will be re-probed. ` +
		`What you can write: target=goal, target=hw-asserted (bench facts no probe can see — jumpers, ` +
		`switch positions, board mode), target=note, target=defect.`
	)
}

// ── evidence: paths and line ranges, never bodies ────────────────────────────────

/**
 * Pull `path:line` / `path:line-line` citations out of free text.
 *
 * Deliberately forgiving about WHERE the citation sits — an `evidence:` key line and a citation
 * dropped mid-sentence both count — because the requirement is that the claim is checkable, not
 * that the model got the shape of the record right. It is strict about what counts as a path: the
 * token before the line number must contain a `.`, `/` or `\`, which is what keeps clock times
 * (`12:34:56`) and ESP-IDF tags out of the results.
 */
export function extractEvidence(content: string): string[] {
	const out: string[] = []
	const seen = new Set<string>()
	for (const raw of content.split(/[\s,;()[\]{}"'`<>|]+/)) {
		// Trailing sentence punctuation: "see src/gw_uart.c:214." must still parse.
		const tok = raw.replace(/[.,;:]+$/, "")
		if (!tok || tok.includes("://")) {
			continue
		}
		const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(tok)
		if (!m) {
			continue
		}
		const p = m[1]
		if (!/[./\\]/.test(p)) {
			continue
		}
		// A bare drive letter is not a path ("C:12" is not evidence).
		if (/^[A-Za-z]:?$/.test(p)) {
			continue
		}
		const norm = m[3] ? `${p}:${m[2]}-${m[3]}` : `${p}:${m[2]}`
		if (!seen.has(norm)) {
			seen.add(norm)
			out.push(norm)
		}
	}
	return out
}

export const EVIDENCE_REJECTION =
	"Memory write rejected: a defect must cite at least one piece of evidence, shaped `path:line` or " +
	"`path:line-line` — for example `src/gw_uart.c:214` or `logs/rtt/cap_1012.log:2211-2247`. Without it " +
	"the next session (or the next you, after a compaction) cannot check the claim or re-read the proof, " +
	"and the defect is a rumour rather than a record. Add the file or log you actually looked at, with the " +
	"line or line range, and call the tool again. Cite the PATH and RANGE — never paste the lines."

export const VERIFIED_REJECTION =
	"Memory write rejected: you may not mark a defect verified. `verified` is host-stamped only — it is set " +
	"after the host observes a real build → flash → capture sequence following your fix, because firmware " +
	"that compiles is not firmware that works. Use `state: under-test` to say you believe it is fixed and are " +
	"waiting for hardware to confirm, and put what you changed in `next:`."

// ── junk lint: memory is not a log sink ──────────────────────────────────────────

/** Consecutive log-shaped lines that turn a write into a paste. */
export const JUNK_RUN_LINES = 5

/** Longest fenced code block a memory write may carry. */
export const MAX_FENCE_CHARS = 400

/**
 * Line shapes that mean "this came off a terminal, not out of your head". Kept as a fixed list of
 * regexes rather than anything statistical so the verdict is identical on every model, every
 * provider and every platform — a small model must be able to predict what will be rejected.
 */
const LOGISH: Array<{ re: RegExp; what: string }> = [
	{ re: /^\s*\[\s*\d{1,2}:\d{2}:\d{2}/, what: "leading [hh:mm:ss] timestamp" },
	{ re: /^\s*\[\s*\d{4}-\d{2}-\d{2}/, what: "leading [date] timestamp" },
	{ re: /^\s*\[\s*\d+\.\d+\s*\]/, what: "kernel-style [   12.345] timestamp" },
	{ re: /^\s*\d{2}:\d{2}:\d{2}([.,]\d+)?\s/, what: "leading hh:mm:ss timestamp" },
	{ re: /^\s*[EWIDVN]\s*\(\s*\d+\s*\)/, what: "ESP-IDF log line, e.g. E (12345) tag:" },
	{ re: /<(err|inf|wrn|dbg)>/i, what: "Zephyr log line (<err>/<inf>/<wrn>/<dbg>)" },
	{ re: /^\s*(?:0x)?[0-9a-fA-F]{4,8}[:\s]\s*(?:[0-9a-fA-F]{2}[\s-]+){4,}/, what: "hex dump row" },
	{ re: /^\s*PS\s+[A-Za-z]:[\\/]/, what: "PowerShell prompt (PS C:\\>)" },
	{ re: /^\s*[A-Za-z]:\\[^>\n]*>/, what: "cmd prompt (C:\\...>)" },
	{ re: /^\s*\$\s+\S/, what: "shell prompt ($ ...)" },
	{ re: /^\s*\d+>\s*\S/, what: "RTT channel prefix (0> ...)" },
]

function junkRunRejection(what: string, atLine: number): string {
	return (
		`Memory write rejected: this looks like pasted output — ${JUNK_RUN_LINES} or more consecutive ` +
		`log/transcript lines starting at line ${atLine} (${what}). Memory stores the CONCLUSION, not the ` +
		`evidence body: everything written here rides in the context of every future turn for this ` +
		`workspace, while the log file costs nothing until someone reads it. Write what the output PROVED ` +
		`in a sentence or two, then cite it by path and line range — e.g. \`logs/rtt/cap_1012.log:2211-2247\` ` +
		`— and call the tool again.`
	)
}

function junkFenceRejection(len: number): string {
	return (
		`Memory write rejected: it contains a fenced code block of ${len} characters (limit ${MAX_FENCE_CHARS}). ` +
		`Memory is not where code or output is stored — the file already holds it. Record what the code does or ` +
		`what the output showed, and cite it by path and line range — e.g. \`src/gw_uart.c:198-241\`. If you need ` +
		`a longer write-up, use target=note; notes are not injected into your context, so they can be generous.`
	)
}

/**
 * Reject pasted logs, transcripts and code dumps. Returns `null` when the content is clean.
 *
 * Blank lines neither count nor break a run: real capture output is full of them, and a blank line
 * cannot be mistaken for prose, so ignoring it makes the lint more sensitive without making it
 * more trigger-happy. A line that reads as prose DOES reset the run, which is what keeps ordinary
 * writing (including a one-line command or a short snippet) from tripping it.
 */
export function lintJunk(content: string): string | null {
	const lines = content.split(/\r?\n/)
	let run = 0
	let runWhat = ""
	let runAt = 0
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (!line.trim()) {
			continue
		}
		const hit = LOGISH.find((l) => l.re.test(line))
		if (hit) {
			if (run === 0) {
				runAt = i + 1
				runWhat = hit.what
			}
			run++
			if (run >= JUNK_RUN_LINES) {
				return junkRunRejection(runWhat, runAt)
			}
		} else {
			run = 0
		}
	}

	for (const f of content.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
		if (f[1].length > MAX_FENCE_CHARS) {
			return junkFenceRejection(f[1].length)
		}
	}
	// An unterminated fence is the same paste with the closing marker lost to a truncation.
	const stripped = content.replace(/```[^\n]*\n[\s\S]*?```/g, "")
	const dangling = stripped.indexOf("```")
	if (dangling >= 0 && stripped.length - dangling - 3 > MAX_FENCE_CHARS) {
		return junkFenceRejection(stripped.length - dangling - 3)
	}
	return null
}

// ── defect content parsing ───────────────────────────────────────────────────────

export interface DefectFields {
	title: string
	/** Only set when the model supplied a state this tool is allowed to accept. */
	state?: DefectState
	/** Whatever the model typed after `state:`, so a rejection can quote it back. */
	stateRaw?: string
	nextStep?: string
	evidence: string[]
	attempted: string[]
}

/** `key: value`, where the key is plain words — so `src/gw_uart.c:214` is never read as a key. */
const KEY_LINE = /^\s*([A-Za-z][A-Za-z _-]*?)\s*:\s*(.*)$/

const oneLine = (t: string): string => t.replace(/\s+/g, " ").trim()

/**
 * Read a defect out of whatever the model sent.
 *
 * Two input shapes are accepted on purpose. Capable models use key lines (`title:`, `state:`,
 * `evidence:`, `next:`); small models write a sentence. Both work, because the only field this tool
 * genuinely REQUIRES is evidence, and evidence is found anywhere in the text.
 */
export function parseDefectFields(content: string): DefectFields {
	let title = ""
	let state: DefectState | undefined
	let stateRaw: string | undefined
	let nextStep: string | undefined
	const evidence: string[] = []
	const attempted: string[] = []
	const prose: string[] = []

	for (const line of content.split(/\r?\n/)) {
		if (!line.trim()) {
			continue
		}
		const m = KEY_LINE.exec(line)
		const key = m ? m[1].trim().toLowerCase().replace(/[_ ]/g, "-") : ""
		const value = m ? m[2].trim() : ""
		switch (key) {
			case "title":
			case "summary":
				title = title || oneLine(value)
				continue
			case "state":
			case "status":
				stateRaw = value.toLowerCase()
				if (stateRaw === "open" || stateRaw === "under-test") {
					state = stateRaw
				}
				continue
			case "next":
			case "next-step":
			case "nextstep":
				nextStep = oneLine(value)
				continue
			case "evidence":
			case "at":
			case "where":
				evidence.push(...extractEvidence(value))
				continue
			case "attempted":
			case "tried":
			case "ruled-out":
				if (value) {
					attempted.push(oneLine(value))
				}
				continue
			default:
				prose.push(line)
		}
	}

	// Evidence cited mid-sentence counts too — the claim is checkable either way.
	for (const e of extractEvidence(content)) {
		if (!evidence.includes(e)) {
			evidence.push(e)
		}
	}
	if (!title) {
		const first = prose.find((l) => !/^\s*[#>*-]/.test(l)) ?? prose[0] ?? ""
		title = oneLine(first).slice(0, 120)
	}
	return { title: title || "(untitled)", state, stateRaw, nextStep, evidence, attempted }
}

/**
 * True when the content tries to claim verification in any of the shapes seen in the wild:
 * `verified: true`, `"verified": true` inside a pasted JSON blob, `verifiedBy=host`.
 */
export function declaresVerified(content: string): boolean {
	return /(^|\n)\s*"?verified(?:-?by)?"?\s*[:=]/i.test(content)
}

// ── the one entry point ──────────────────────────────────────────────────────────

/**
 * Decide whether a write may proceed. Every rejection names what to do INSTEAD — a rejection that
 * only says "no" costs a turn and teaches the model nothing, so it gets retried verbatim.
 *
 * Order matters and is asserted by the tests: ownership → shape → size → junk → defect rules.
 */
export function validateMemoryWrite(req: MemoryWriteRequest): WriteDecision {
	const rawTarget = (req.target ?? "").trim().toLowerCase()
	const rawOp = (req.op ?? "").trim().toLowerCase()
	const rawId = (req.id ?? "").trim()
	const content = req.content ?? ""

	// Ownership first: a model reaching for `apps` must hear WHY, not "unknown target".
	const owned = hostOwnedName(rawTarget) ?? hostOwnedName(rawId)
	if (owned) {
		return reject(hostOwnedRejection(owned))
	}

	if (!rawTarget) {
		return reject(`Missing 'target'. It must be one of: ${MEMORY_TARGETS.join(" | ")}.`)
	}
	if (!(MEMORY_TARGETS as readonly string[]).includes(rawTarget)) {
		return reject(
			`Unknown target '${rawTarget}'. Use one of: goal (the project's objective), ` +
				`hw-asserted (a bench fact only the developer knows — jumper, switch position, board mode), ` +
				`note (a topic write-up in .adsum/notes/), defect (a bug you are working).`,
		)
	}
	const target = rawTarget as MemoryTarget

	if (!rawOp) {
		return reject(`Missing 'op'. For target=${target} it must be one of: ${ALLOWED_OPS[target].join(" | ")}.`)
	}
	if (!(MEMORY_OPS as readonly string[]).includes(rawOp)) {
		return reject(`Unknown op '${rawOp}'. Use one of: ${MEMORY_OPS.join(" | ")}.`)
	}
	const op = rawOp as MemoryOp

	if (!ALLOWED_OPS[target].includes(op)) {
		if (target === "goal") {
			return reject(
				`op='${op}' is not valid for target=goal. The goal is append-only history with the current goal ` +
					`on top: use op=set and the previous goal is preserved automatically as a prior goal. Goals are ` +
					`rare — if what you are recording is this bug rather than the project's objective, use ` +
					`target=defect instead.`,
			)
		}
		return reject(`op='${op}' is not valid for target=${target}. Valid ops here: ${ALLOWED_OPS[target].join(" | ")}.`)
	}

	if ((target === "note" || target === "defect") && !rawId) {
		return reject(
			`target=${target} requires 'id' — ${
				target === "note"
					? "a short slug naming the topic, e.g. 'uart-ringbuffer'. It becomes .adsum/notes/<id>.md."
					: "a short stable id for the bug, e.g. 'uart-drop'. Reuse the same id every time you learn something about it."
			}`,
		)
	}
	if (target === "hw-asserted" && op === "delete" && !rawId) {
		return reject(
			"target=hw-asserted with op=delete requires 'id' — the board serial or port whose asserted fact you " +
				"are removing. Without it there is no way to tell which fact you mean.",
		)
	}

	const id = target === "hw-asserted" ? rawId : slugify(rawId)
	if ((target === "note" || target === "defect") && !id) {
		return reject(`'id' must contain at least one letter or digit — '${rawId}' slugifies to nothing.`)
	}

	const needsContent = op !== "close" && op !== "delete"
	if (needsContent && !content.trim()) {
		return reject(`op='${op}' on target=${target} requires 'content'. Only op=close and op=delete may omit it.`)
	}

	if (needsContent) {
		const tooBig = checkSectionWriteSize(CAP_SECTION[target], content)
		if (tooBig) {
			return reject(tooBig)
		}
		const junk = lintJunk(content)
		if (junk) {
			return reject(junk)
		}
	}

	if (target === "defect" && needsContent) {
		// Authority before completeness: claiming verification is a bigger error than omitting evidence.
		if (declaresVerified(content)) {
			return reject(VERIFIED_REJECTION)
		}
		const fields = parseDefectFields(content)
		if (fields.stateRaw && !fields.state) {
			if (fields.stateRaw === "closed" || fields.stateRaw === "fixed" || fields.stateRaw === "resolved") {
				return reject(
					`To close a defect call this tool again with op=close (no content needed). 'state: ${fields.stateRaw}' ` +
						`is not accepted in content — closing is an operation, not a field, so it is recorded as one.`,
				)
			}
			return reject(`Unknown defect state '${fields.stateRaw}'. You may set 'open' or 'under-test' only.`)
		}
		if (fields.evidence.length === 0) {
			return reject(EVIDENCE_REJECTION)
		}
	}

	return { ok: true, target, op, id: id || undefined, content }
}

// ── goal: append-only history ────────────────────────────────────────────────────

/** How many superseded goals status.json keeps. Bounded so the ledger cannot grow without limit. */
export const MAX_PRIOR_GOALS = 10

/**
 * Record a new goal WITHOUT losing the old one.
 *
 * This is the whole defence against goal drift. A model that has spent four hours on a UART bug and
 * is then asked to "update the goal" will write the bug as the goal; if that were a plain
 * assignment, the project's actual objective would be gone with nothing left to notice it. Moving
 * the previous goal into priorGoals makes the substitution visible and reversible instead.
 */
export function applyGoal(status: StatusJson, text: string, nowIso: string): StatusJson {
	const next = oneLine(text)
	const current = status.goal
	if (current && oneLine(current.text) === next) {
		return status
	}
	const priorGoals = current
		? [{ text: current.text, setAt: current.setAt }, ...(status.priorGoals ?? [])].slice(0, MAX_PRIOR_GOALS)
		: status.priorGoals
	return {
		...status,
		goal: { text: next, setAt: nowIso, setBy: "model" },
		priorGoals,
	}
}

// ── defects ──────────────────────────────────────────────────────────────────────

export type DefectApply = { ok: true; status: StatusJson; summary: string } | { ok: false; reason: string }

/** Union that keeps the existing order — the first citation recorded stays the primary one. */
function mergeEvidence(existing: string[], incoming: string[]): string[] {
	const out = [...existing]
	for (const e of incoming) {
		if (!out.includes(e)) {
			out.push(e)
		}
	}
	return out
}

/**
 * Fold one defect write into the ledger.
 *
 * `verified` / `verifiedBy` are carried forward from the existing record and are never taken from
 * the model's input — the field exists so the HOST can stamp it after it watches a build → flash →
 * capture cycle, and a model-set value would make that signal worthless.
 */
export function applyDefect(status: StatusJson, op: MemoryOp, id: string, fields: DefectFields, nowIso: string): DefectApply {
	const defects = [...status.defects]
	const idx = defects.findIndex((d) => d.id === id)
	const existing = idx >= 0 ? defects[idx] : undefined

	if (op === "delete") {
		if (!existing) {
			return { ok: false, reason: `No defect '${id}' in the ledger, so there is nothing to delete.` }
		}
		defects.splice(idx, 1)
		return { ok: true, status: { ...status, defects }, summary: `Defect '${id}' removed from the ledger.` }
	}

	if (op === "close") {
		if (!existing) {
			return {
				ok: false,
				reason:
					`No defect '${id}' in the ledger, so there is nothing to close. Record it first with ` +
					`op=set (title plus at least one path:line citation), then close it.`,
			}
		}
		defects[idx] = { ...existing, state: "closed", updatedAt: nowIso }
		return {
			ok: true,
			status: { ...status, defects },
			summary: `Defect '${id}' closed. It stays in the ledger as history but is no longer recited to you each turn.`,
		}
	}

	const next: Defect = {
		id,
		title: fields.title !== "(untitled)" ? fields.title : (existing?.title ?? fields.title),
		state: fields.state ?? existing?.state ?? "open",
		evidence: mergeEvidence(existing?.evidence ?? [], fields.evidence),
		attempted: (() => {
			const merged = mergeEvidence(existing?.attempted ?? [], fields.attempted)
			return merged.length > 0 ? merged : undefined
		})(),
		nextStep: fields.nextStep ?? existing?.nextStep,
		// Host-stamped only — carried through untouched, never read from `fields`.
		verified: existing?.verified,
		verifiedBy: existing?.verifiedBy,
		updatedAt: nowIso,
	}

	if (op === "append" && existing) {
		// `append` records what was TRIED, so the next session stops re-trying it.
		const tried = fields.attempted.length > 0 ? fields.attempted : [oneLine(fields.title)]
		next.attempted = mergeEvidence(existing.attempted ?? [], tried)
		next.title = existing.title
	}

	if (idx >= 0) {
		defects[idx] = next
	} else {
		defects.push(next)
	}
	return {
		ok: true,
		status: { ...status, defects },
		summary: `Defect '${id}' ${existing ? "updated" : "recorded"} [${next.state}] with ${next.evidence.length} evidence citation${
			next.evidence.length === 1 ? "" : "s"
		}.`,
	}
}

// ── PROJECT.md sections the model owns ───────────────────────────────────────────

export const ASSERTED_SECTION_ID = "hardware-asserted"
export const NOTES_SECTION_ID = "notes"

/** Headings match render.ts byte-for-byte so the two writers produce the same-looking document. */
export const ASSERTED_HEADING = "## Hardware — asserted by developer"
export const ASSERTED_NOTE = "_Bench facts the host cannot detect (jumpers, switch positions, modes)._"
export const NOTES_HEADING = "## Notes"
export const NOTES_LEAD = "Topic files — not injected. `read_file` one before working in its area."

/**
 * Pull one section's body out of PROJECT.md.
 *
 * Two fence shapes are recognised on purpose: the managed block this tool writes
 * (`adsum:managed:begin id=…`), and the render.ts section fence (`adsum:<id> owner=…`) used when
 * the host regenerates the whole document. Reading both means an append never loses what the other
 * writer put there.
 */
export function extractSectionBody(md: string, sectionId: string): string {
	const esc = sectionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const managed = new RegExp(`<!--\\s*adsum:managed:begin id=${esc}[^>]*-->([\\s\\S]*?)<!--\\s*adsum:managed:end\\s*-->`)
	const rendered = new RegExp(`<!--\\s*adsum:${esc}(?:\\s[^>]*?)?-->([\\s\\S]*?)<!--\\s*/adsum:${esc}\\s*-->`)
	return (managed.exec(md)?.[1] ?? rendered.exec(md)?.[1] ?? "").trim()
}

/** `- ` bullets only — headings and the explanatory note line are not data. */
function bulletsOf(body: string): string[] {
	return body
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.startsWith("- "))
		.map((l) => l.slice(2).trim())
		.filter(Boolean)
}

export function parseAssertedBullets(md: string): string[] {
	return bulletsOf(extractSectionBody(md, ASSERTED_SECTION_ID))
}

export function renderAssertedBody(bullets: string[]): string {
	if (bullets.length === 0) {
		return `${ASSERTED_HEADING}\n\n${ASSERTED_NOTE}`
	}
	return `${ASSERTED_HEADING}\n\n${ASSERTED_NOTE}\n${bullets.map((b) => `- ${oneLine(b)}`).join("\n")}`
}

/** `id — fact` when the fact belongs to a board, so the bullet is self-identifying and deletable. */
export function assertedBullet(id: string | undefined, content: string): string {
	return id ? `${id} — ${oneLine(content)}` : oneLine(content)
}

/** True when this bullet is the one the given board id owns. */
export function assertedBulletHasId(bullet: string, id: string): boolean {
	return bullet.toLowerCase().startsWith(`${id.toLowerCase()} — `)
}

export interface NoteIndexEntry {
	title: string
	summary: string
	/** ABSOLUTE — the model cannot derive `.adsum/notes/<slug>.md` from anything it is shown. */
	path: string
}

export function parseNotesIndex(md: string): NoteIndexEntry[] {
	const out: NoteIndexEntry[] = []
	for (const b of bulletsOf(extractSectionBody(md, NOTES_SECTION_ID))) {
		const parts = b.split(" — ")
		if (parts.length < 3) {
			continue
		}
		const path = parts[parts.length - 1].trim()
		out.push({ title: parts[0].trim(), summary: parts.slice(1, -1).join(" — ").trim(), path })
	}
	return out
}

export function renderNotesIndexBody(entries: NoteIndexEntry[]): string {
	if (entries.length === 0) {
		return `${NOTES_HEADING}\n\n_No topic notes yet._`
	}
	// Sorted by path: the index rides in the cached system prompt, so its byte order must not depend
	// on the order writes happened to arrive in.
	const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
	const bullets = sorted.map((n) => `- ${oneLine(n.title)} — ${oneLine(n.summary)} — ${n.path}`).join("\n")
	return `${NOTES_HEADING}\n\n${NOTES_LEAD}\n${bullets}`
}

/** Slug for a note file name or a defect id: safe on Windows, and no way out of notes/. */
export function slugify(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
}

/** A note's index title: its first markdown heading if it has one, else the slug. */
export function noteTitle(slug: string, content: string): string {
	const heading = /^\s{0,3}#{1,6}\s+(.+)$/m.exec(content)
	return oneLine(heading?.[1] ?? slug).slice(0, 80)
}

/** The one line shown in the index before the model decides whether to read the file. */
export function summarizeNote(content: string, max = 140): string {
	const line = content
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l && !l.startsWith("#") && !l.startsWith("```"))
	const clean = oneLine(line ?? "").replace(/[*_`]/g, "")
	if (!clean) {
		return "(no summary)"
	}
	return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

/** Re-exported so the handler and the tests quote the same numbers the rejections do. */
export const NOTE_CAP = SECTION_WRITE_CAPS.note
