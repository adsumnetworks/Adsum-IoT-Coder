import type { ClineToolResponseContent } from "@shared/messages/content"

/**
 * Fold a verbose `idf.py build` log before it enters the model's context.
 *
 * The terminal layer already caps command output at ~500 lines, but a full ESP-IDF build is almost all compiler
 * noise — the signal is the first lines (command + config banner), any error/warning lines, and the tail (the
 * binary-size summary on success, or the failure on error). Keep those, drop the middle. A real CRA run chained
 * two full builds + report rewrites and overran the 200K window; trimming each build's footprint — without losing
 * the success/failure signal — is part of fixing that. Pure (no vscode), so it is unit-tested directly.
 */
export function foldEspBuildLog(text: string): string {
	const lines = text.split("\n")
	const HEAD = 12
	const TAIL = 60
	const THRESHOLD = 90 // below this, the log is already small enough — leave it verbatim
	if (lines.length <= THRESHOLD) {
		return text
	}
	const head = lines.slice(0, HEAD)
	const tail = lines.slice(lines.length - TAIL)
	const middle = lines.slice(HEAD, lines.length - TAIL)
	// Never fold away a failure: keep error/warning-class lines from the middle (capped so a warning storm can't
	// re-bloat the output).
	const kept = middle
		.filter((l) => /\b(error|warning|FAILED|fatal|undefined reference|ninja: build stopped)\b/i.test(l))
		.slice(0, 40)
	const foldedCount = middle.length - kept.length
	const marker = `… [${foldedCount} build lines folded — kept head + ${kept.length} error/warning line(s) + tail; full log is in the "Adsum ESP-IDF" terminal] …`
	return [...head, marker, ...kept, ...tail].join("\n")
}

/** Apply {@link foldEspBuildLog} to a command result whether it's a plain string or text content blocks. */
export function foldEspBuildResult(result: ClineToolResponseContent): ClineToolResponseContent {
	if (typeof result === "string") {
		return foldEspBuildLog(result)
	}
	if (Array.isArray(result)) {
		return result.map((b) =>
			b && (b as { type?: string }).type === "text" && typeof (b as { text?: unknown }).text === "string"
				? { ...b, text: foldEspBuildLog((b as { text: string }).text) }
				: b,
		)
	}
	return result
}
