/**
 * Size limits for the IoT project-memory files — pure + tested.
 *
 * Project memory is injected into EVERY system prompt for the workspace, so an unbounded
 * `session.md` would silently inflate the prompt forever (this is why the read-back was
 * originally left commented out). Two caps make the loop safe:
 *
 *   - WRITE cap  — the handler refuses to persist a memory file larger than
 *                  MEMORY_WRITE_CAP chars, forcing the model to condense.
 *   - INJECT cap — the manager injects at most MEMORY_INJECT_CAP chars per file, keeping
 *                  the NEWEST tail (by convention the newest state is appended at the
 *                  bottom) behind an explicit truncation notice that points at the file
 *                  so the model can `read_file` the whole thing when it actually needs it.
 *
 * Kept in its own module (no HostProvider / no vscode) so both the manager and the tool
 * handler share one source of truth and the logic is unit-testable in isolation.
 * Run: npm run test:memory
 */

/** Max chars of a single memory file injected into the system prompt. */
export const MEMORY_INJECT_CAP = 6000

/** Max chars accepted by a single `update_project_memory` write. */
export const MEMORY_WRITE_CAP = 24000

/** 24000 → "24,000" — locale-independent so prompts and tests are deterministic. */
function comma(n: number): string {
	return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/**
 * Prepare a memory file's content for prompt injection: trimmed, and capped at `cap`
 * chars. When it is over the cap, keep the LAST `cap` chars (newest state) and prefix a
 * notice naming the absolute path so the model knows what it is missing and where to
 * read it from.
 */
export function truncateMemoryForInjection(content: string, fullPath: string, cap: number = MEMORY_INJECT_CAP): string {
	const trimmed = content.trim()
	if (trimmed.length <= cap) {
		return trimmed
	}
	const tail = trimmed.slice(-cap)
	return `(truncated: showing newest ${comma(cap)} of ${comma(trimmed.length)} chars — file at ${fullPath})\n${tail}`
}

/**
 * Guard a memory write. Returns `null` when the content is acceptable, otherwise the
 * error text to hand back to the model (it explains HOW to shrink, not just that it failed).
 */
export function checkMemoryWriteSize(filename: string, content: string, cap: number = MEMORY_WRITE_CAP): string | null {
	if (content.length <= cap) {
		return null
	}
	return (
		`Memory write rejected: '${filename}' would be ${comma(content.length)} chars, over the ${comma(cap)}-char limit ` +
		`for a memory file. Memory is a condensed summary that is re-injected into every prompt, not a log. ` +
		`Write a condensed version — keep the current state, the decisions and the findings that still matter; ` +
		`drop resolved issues, raw log dumps, command transcripts and superseded notes — then call update_project_memory again.`
	)
}

// ── per-section caps for workspace memory (`.adsum/`) ────────────────────────────

/**
 * The whole-file cap above is the wrong instrument for `.adsum/`, where memory is a set of
 * small owned sections rather than one blob. A 24,000-char goal is nonsense long before it is
 * "too big", and rejecting it only at the file cap teaches the model nothing.
 *
 * These caps are budgets, sized by where the text ends up:
 *   - `goal`, `focus`      — one line each, recited in the tail block on EVERY turn.
 *   - `hardware-asserted`  — a handful of bench facts, injected in the system prompt.
 *   - `defect`             — one ledger entry; evidence is PATHS and LINE RANGES, never log bodies.
 *   - `map`                — host-generated workspace map, conditionally injected.
 *   - `note`               — a `.adsum/notes/*.md` topic file. Never injected, only `read_file`d,
 *                            so it can be generous — that generosity is exactly what keeps the
 *                            injected sections small.
 * Renderer-side caps (PROJECT.md 4,096 / tail block 1,600) live in
 * `workspace/render.ts`; these are the WRITE-side guards that stop oversized content reaching it.
 */
export const SECTION_WRITE_CAPS: Record<string, number> = {
	goal: 400,
	focus: 300,
	"hardware-asserted": 1500,
	defect: 1500,
	map: 4000,
	note: 8000,
}

/** Unknown section names fall back to the file cap — bounded, but not a silent free pass. */
export const DEFAULT_SECTION_WRITE_CAP = MEMORY_WRITE_CAP

/** Section-specific advice, so the rejection says what to do rather than only what failed. */
const SECTION_ADVICE: Record<string, string> = {
	goal: "A goal is one sentence naming the outcome, not the plan to reach it. Put the detail in a note under .adsum/notes/.",
	focus: "Focus is one line about what you are doing RIGHT NOW. It is recited every turn, so it has to be short.",
	"hardware-asserted":
		"Record only bench facts the host cannot detect (jumpers, switch positions, modes) — one short line each.",
	defect: "Keep the title, the next step, and evidence as PATHS with line ranges. Never paste log bodies into a defect.",
	map: "The map is an index, not a listing. Fold directories the agent does not need to open.",
	note: "Split this into more than one topic note under .adsum/notes/ — one subject per file.",
}

/**
 * Guard a single-section write into `.adsum/`. Returns `null` when acceptable, otherwise the
 * error text to hand back to the model. Mirrors checkMemoryWriteSize: name the section, both
 * sizes, and how to shrink it.
 */
export function checkSectionWriteSize(section: string, content: string): string | null {
	const cap = SECTION_WRITE_CAPS[section] ?? DEFAULT_SECTION_WRITE_CAP
	if (content.length <= cap) {
		return null
	}
	const advice = SECTION_ADVICE[section] ?? "Condense it: keep what is still true and still actionable, drop the rest."
	return (
		`Memory write rejected: section '${section}' would be ${comma(content.length)} chars, over the ` +
		`${comma(cap)}-char limit for that section. ${advice} Rewrite it shorter and call the tool again.`
	)
}
