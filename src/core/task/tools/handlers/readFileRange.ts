/**
 * Optional line-window for read_file.
 *
 * Measured motivation: on a live run the agent read a 69,739-char `sdkconfig` in full *after*
 * search_files had already located the 570-char answer — not because it wanted the rest, but
 * because `path` was read_file's only parameter. `start_line`/`end_line` give it the cheaper move.
 *
 * Kept as a dependency-free module (no vscode, no host) so it can be unit-tested under ts-node
 * and reused wherever a text window is needed. Semantics: 1-based, inclusive on both ends.
 */

export interface LineRangeResult {
	/** The windowed text (or the original text verbatim when no valid range was requested). */
	text: string
	/** True when a range was actually applied — callers use this to decide whether to annotate. */
	applied: boolean
	/** First line included, 1-based (meaningful only when `applied`). */
	start: number
	/** Last line included, 1-based inclusive (meaningful only when `applied`). */
	end: number
	/** Total number of lines in the source text. */
	total: number
}

/**
 * Parse a line number that arrives as a string in XML tool-call mode (and as a number in native
 * mode). Anything that isn't a whole number — "", "abc", "12abc", "1.5", undefined — is IGNORED
 * (returns undefined) rather than treated as 0, so a malformed param degrades to a whole-file read
 * instead of silently returning the wrong slice.
 */
function parseLineNumber(raw: string | number | undefined | null): number | undefined {
	if (raw === undefined || raw === null) {
		return undefined
	}
	const text = String(raw).trim()
	if (!/^[+-]?\d+$/.test(text)) {
		return undefined
	}
	const parsed = parseInt(text, 10)
	return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Slice `text` to the requested 1-based inclusive line window.
 *
 * Rules (all forgiving — a bad range must never fail the read):
 *  - both omitted/invalid → whole file, `applied: false`
 *  - only one supplied    → open-ended on the other side (start→EOF, or 1→end)
 *  - reversed             → swapped
 *  - out of bounds        → clamped into [1, total]
 */
export function sliceLineRange(
	text: string,
	startRaw?: string | number | null,
	endRaw?: string | number | null,
): LineRangeResult {
	const lines = text.split("\n")
	// A trailing newline produces a final empty element that is not a real line; dropping it keeps
	// "total" equal to what an editor's gutter shows.
	if (lines.length > 1 && lines[lines.length - 1] === "") {
		lines.pop()
	}
	const total = lines.length

	let start = parseLineNumber(startRaw)
	let end = parseLineNumber(endRaw)

	if (start === undefined && end === undefined) {
		return { text, applied: false, start: 1, end: total, total }
	}

	// Reversed range: the model meant the window between the two numbers.
	if (start !== undefined && end !== undefined && start > end) {
		const swap = start
		start = end
		end = swap
	}

	const clamp = (n: number) => Math.min(Math.max(n, 1), Math.max(total, 1))
	const first = clamp(start ?? 1)
	const last = clamp(end ?? total)

	return { text: lines.slice(first - 1, last).join("\n"), applied: true, start: first, end: last, total }
}

/** The one-line header prefixed to a windowed read so the model knows what it did and didn't get. */
export function formatRangeHeader(range: LineRangeResult, displayPath: string): string {
	return `[Lines ${range.start}-${range.end} of ${range.total} — ${displayPath}]`
}
