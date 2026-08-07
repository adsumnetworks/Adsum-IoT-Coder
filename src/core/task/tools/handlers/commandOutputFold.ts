import type { ClineToolResponseContent } from "@shared/messages/content"

/**
 * Fold LONG COMMAND OUTPUT at the terminal boundary, before it enters the model's context.
 *
 * This started as an ESP-IDF build-log fold, but every command is capable of the same blow-up: measured leaks
 * include a `west build --sysbuild` at 44K chars, a `.bat` build at ~43K tokens, `idf.py build` at ~36K tokens,
 * and a single failed `Remove-Item` at ~32K tokens of PowerShell spew. The signal in all of them is the same
 * shape — the first lines (the command + its banner), any error/warning-class line, and the tail (the result,
 * the summary, the failure) — so keep those and drop the middle.
 *
 * Two independent triggers, because "long" has two failure modes: many lines (compiler noise) and few enormous
 * lines (a minified blob, one giant PowerShell error record). Lines are folded first; a char clamp then holds a
 * hard budget for whatever survives.
 *
 * Rules:
 *   - Under BOTH thresholds → returned byte-identical. Folding must never touch small output.
 *   - Error/warning-class lines in the middle are always kept, capped; an overflow is announced, never silent.
 *   - The result always ends with a notice stating what was folded and where the full output lives.
 *
 * Pure (no vscode, no fs), so it is unit-tested directly. IMPORTANT: only ever apply this to the text returned
 * to the model — the user's terminal and the UI must keep the full output.
 */

export interface CommandOutputFoldOptions {
	/** Lines kept verbatim from the start (the command + its banner). */
	headLines?: number
	/** Lines kept verbatim from the end (the result / summary / failure). */
	tailLines?: number
	/** Fold once the output exceeds this many lines. */
	maxLines?: number
	/** Fold once the output exceeds this many characters (catches few-but-enormous lines). */
	maxChars?: number
	/** Cap on error/warning-class lines rescued from the middle; the overflow is announced. */
	maxErrorLines?: number
	/** Path of the full output on disk, if the caller tee'd one — named in the notice. */
	outputPath?: string
	/** Where the full output is still visible, if not a file (e.g. `the "Adsum nRF" terminal`). */
	source?: string
	/** What the folded text IS, for the notice — defaults to "LONG COMMAND OUTPUT" (e.g. "LONG FILE"). */
	label?: string
}

export const COMMAND_OUTPUT_FOLD_DEFAULTS = {
	headLines: 12,
	tailLines: 60,
	maxLines: 120,
	maxChars: 20_000,
	maxErrorLines: 60,
} as const

/**
 * Lines worth rescuing from the folded middle. Deliberately broad — a false positive costs one kept line, a
 * false negative costs the diagnosis. Covers compilers/linkers (error/warning/fatal/undefined reference),
 * build drivers (FAILED, ninja: build stopped), Python (Traceback), runtime faults (assert/panic/exception),
 * and PowerShell error records (CategoryInfo / FullyQualifiedErrorId).
 */
const ERROR_LINE =
	/\b(errors?|warnings?|fatal|failed|failure|exception|assert(?:ion)?|panic|undefined reference|ninja: build stopped|CategoryInfo|FullyQualifiedErrorId)\b|Traceback \(most recent call last\)/i

export function isErrorLine(line: string): boolean {
	return ERROR_LINE.test(line)
}

/** Hard character budget: keep the head and (a larger) tail, cut the middle. Used after the line fold. */
function clampChars(text: string, maxChars: number): { text: string; omitted: number } {
	if (text.length <= maxChars) {
		return { text, omitted: 0 }
	}
	const headChars = Math.floor(maxChars * 0.35)
	const tailChars = maxChars - headChars
	const omitted = text.length - headChars - tailChars
	return {
		text: `${text.slice(0, headChars)}\n… [${omitted} characters folded] …\n${text.slice(text.length - tailChars)}`,
		omitted,
	}
}

/** Fold one blob of command output. Returns it unchanged when it is under both thresholds. */
export function foldCommandOutputText(text: string, options: CommandOutputFoldOptions = {}): string {
	if (!text) {
		return text
	}
	const headLines = options.headLines ?? COMMAND_OUTPUT_FOLD_DEFAULTS.headLines
	const tailLines = options.tailLines ?? COMMAND_OUTPUT_FOLD_DEFAULTS.tailLines
	const maxLines = options.maxLines ?? COMMAND_OUTPUT_FOLD_DEFAULTS.maxLines
	const maxChars = options.maxChars ?? COMMAND_OUTPUT_FOLD_DEFAULTS.maxChars
	const maxErrorLines = options.maxErrorLines ?? COMMAND_OUTPUT_FOLD_DEFAULTS.maxErrorLines

	const lines = text.split("\n")
	if (lines.length <= maxLines && text.length <= maxChars) {
		return text
	}

	let body = text
	let foldedLines = 0
	let keptErrorLines = 0
	// Only fold by line when there is a genuine middle to drop; otherwise the char clamp below does the work.
	if (lines.length > headLines + tailLines) {
		const head = lines.slice(0, headLines)
		const tail = lines.slice(lines.length - tailLines)
		const middle = lines.slice(headLines, lines.length - tailLines)
		const matches = middle.filter(isErrorLine)
		const kept = matches.slice(0, maxErrorLines)
		const overflow = matches.length - kept.length
		keptErrorLines = kept.length
		foldedLines = middle.length - kept.length

		const parts = [...head, `… [${foldedLines} line(s) folded from the middle] …`, ...kept]
		if (overflow > 0) {
			parts.push(`… and ${overflow} more error/warning line(s) not shown — see the full output …`)
		}
		parts.push(...tail)
		body = parts.join("\n")
	}

	const clamped = clampChars(body, maxChars)

	const what: string[] = []
	if (foldedLines > 0) {
		what.push(`${foldedLines} of ${lines.length} lines folded`)
	}
	if (clamped.omitted > 0) {
		what.push(`${clamped.omitted} characters trimmed`)
	}
	const where = options.outputPath
		? ` Full output: ${options.outputPath}`
		: options.source
			? ` Full output is in ${options.source}.`
			: " The full output was shown in the terminal."
	const kept =
		foldedLines > 0
			? `kept the first ${headLines} line(s), ${keptErrorLines} error/warning line(s) from the middle, and the last ${tailLines} line(s)`
			: "kept the start and the end of the output"
	const notice = `… [${options.label ?? "LONG COMMAND OUTPUT"} FOLDED — ${what.join(", ")}; ${kept}.${where}] …`

	return `${clamped.text}\n${notice}`
}

/**
 * Apply {@link foldCommandOutputText} to a tool result, whether it is a plain string or text content blocks.
 * Non-text blocks (images) pass through untouched.
 */
export function foldCommandOutput<T extends ClineToolResponseContent>(result: T, options: CommandOutputFoldOptions = {}): T {
	if (typeof result === "string") {
		return foldCommandOutputText(result, options) as T
	}
	if (Array.isArray(result)) {
		return result.map((b) =>
			b && (b as { type?: string }).type === "text" && typeof (b as { text?: unknown }).text === "string"
				? { ...b, text: foldCommandOutputText((b as { text: string }).text, options) }
				: b,
		) as T
	}
	return result
}
