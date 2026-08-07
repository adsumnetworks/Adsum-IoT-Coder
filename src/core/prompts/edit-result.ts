import * as diff from "diff"

/**
 * Edit-result formatting — what a SUCCESSFUL file edit sends back to the MODEL.
 *
 * Why this exists: every successful edit used to echo the entire post-edit file back
 * (`<final_file_content>`). Five `replace_in_file` edits to one 32 KB source file therefore
 * cost ~158 KB (~40K tokens) of context inside three minutes, and the context manager only
 * collapsed those duplicates later, reactively, at compaction time. An edit to an EXISTING
 * file now returns the applied diff plus a ±20-line window around each changed hunk — the
 * model already knows the rest of the file, and what it needs is confirmation of what landed.
 *
 * NEW files still echo their content (up to a cap) because the model just authored it and
 * downstream consumers (ContextManager dedup, the apply_patch history adapter) key on the
 * `<final_file_content>` block.
 *
 * NOTE: this only affects the text returned to the model. The diff view / chat rows the USER
 * sees are built separately in the handlers and are unchanged.
 */

/** A brand-new file up to this many chars is echoed back verbatim; above it, only a summary. */
export const NEW_FILE_ECHO_CHAR_CAP = 10_000

/** Lines of context shown on each side of every changed hunk. */
export const CONTEXT_WINDOW_LINES = 20

/** Safety caps so a whole-file rewrite can't reintroduce the very problem this module fixes. */
const DIFF_CHAR_CAP = 8_000
const REGIONS_CHAR_CAP = 12_000

export const EDIT_APPLIED_SENTENCE = "The edit was applied exactly as shown; re-read the file only if you need unrelated regions."

export interface EditResultInput {
	/** Workspace-relative (or display) path, as shown to the user. */
	relPath: string
	/** Absolute path on disk, when the handler knows it. */
	absolutePath?: string
	/** False when this call CREATED the file. */
	fileExisted: boolean
	/** Content before the edit (undefined for a creation). */
	originalContent?: string
	/** Content on disk after save, including auto-formatting. */
	finalContent?: string
	/** Pretty patch of the user's own modifications made in the diff view before approving. */
	userEdits?: string
	/** Pretty patch of the editor's auto-formatting applied on save. */
	autoFormattingEdits?: string
	/** Diagnostics message produced after the save (already formatted, may be ""). */
	newProblemsMessage?: string
}

/** What a handler knows about the edit beyond the legacy formatResponse arguments. */
export interface EditResultContext {
	originalContent?: string
	absolutePath?: string
	/** Defaults to true (an edit of an existing file) when the handler doesn't say. */
	fileExisted?: boolean
}

export interface LineWindow {
	/** 1-based, inclusive. */
	start: number
	/** 1-based, inclusive. */
	end: number
}

function toPosix(p: string): string {
	return p.replace(/\\/g, "/")
}

function normalizeEol(text: string): string {
	return text.replace(/\r\n/g, "\n")
}

/** Number of real lines in `text`, ignoring a single trailing newline. */
export function countLines(text: string): number {
	if (text === "") {
		return 0
	}
	const lines = text.split("\n")
	if (lines[lines.length - 1] === "") {
		lines.pop()
	}
	return lines.length
}

function capText(text: string, cap: number, what: string): string {
	if (text.length <= cap) {
		return text
	}
	const kept = text.slice(0, cap)
	// cut at the last complete line so we never emit half a line of code
	const lastNewline = kept.lastIndexOf("\n")
	const body = lastNewline > 0 ? kept.slice(0, lastNewline) : kept
	const shown = countLines(`${body}\n`)
	const total = countLines(`${text}\n`)
	return `${body}\n... [${what} truncated — ${shown} of ${total} lines shown]`
}

/**
 * The ±`contextLines` windows (1-based, in the POST-edit file) around every changed hunk.
 * Overlapping/adjacent windows are merged so the same lines are never printed twice.
 */
export function changedLineWindows(
	originalContent: string,
	finalContent: string,
	contextLines: number = CONTEXT_WINDOW_LINES,
): LineWindow[] {
	const total = countLines(finalContent)
	if (total === 0) {
		return []
	}
	const patch = diff.structuredPatch("file", "file", originalContent, finalContent, "", "", { context: 0 })
	const raw: LineWindow[] = []
	for (const hunk of patch.hunks) {
		// A pure deletion has newLines === 0; anchor the window at the deletion point.
		const hunkStart = Math.max(1, hunk.newStart)
		const hunkEnd = hunk.newLines === 0 ? hunkStart : hunk.newStart + hunk.newLines - 1
		raw.push({
			start: Math.max(1, hunkStart - contextLines),
			end: Math.min(total, Math.max(1, hunkEnd) + contextLines),
		})
	}
	raw.sort((a, b) => a.start - b.start)

	const merged: LineWindow[] = []
	for (const w of raw) {
		const last = merged[merged.length - 1]
		if (last && w.start <= last.end + 1) {
			last.end = Math.max(last.end, w.end)
		} else {
			merged.push({ ...w })
		}
	}
	return merged
}

/** Line-numbered rendering of the given windows of the post-edit file. */
export function renderChangedRegions(finalContent: string, windows: LineWindow[]): string {
	const lines = finalContent.split("\n")
	if (lines[lines.length - 1] === "") {
		lines.pop()
	}
	const total = lines.length
	const width = String(total).length
	const out: string[] = []
	for (const w of windows) {
		out.push(`--- lines ${w.start}-${w.end} of ${total} ---`)
		for (let n = w.start; n <= w.end && n <= total; n++) {
			out.push(`${String(n).padStart(width, " ")} | ${lines[n - 1]}`)
		}
	}
	return out.join("\n")
}

/** Unified diff of the applied change, header lines stripped (same shape as createPrettyPatch). */
function unifiedDiff(relPath: string, originalContent: string, finalContent: string): string {
	const patch = diff.createPatch(toPosix(relPath), originalContent, finalContent, "", "", { context: 3 })
	return patch.split("\n").slice(4).join("\n").trimEnd()
}

function autoFormattingSection(autoFormattingEdits?: string): string {
	if (!autoFormattingEdits) {
		return ""
	}
	return (
		`The user's editor also applied auto-formatting on save:\n\n${autoFormattingEdits}\n\n` +
		`(Note: watch for quote style, semicolons, line wrapping, indentation and trailing commas — future SEARCH blocks must match the formatted text.)\n\n`
	)
}

function pathHeader(relPath: string, absolutePath?: string): string {
	const rel = toPosix(relPath)
	if (!absolutePath || toPosix(absolutePath) === rel) {
		return rel
	}
	return `${rel} (absolute: ${absolutePath})`
}

/**
 * Build the tool result for a successful edit. Existing files get diff + windows; new files get
 * their content echoed up to {@link NEW_FILE_ECHO_CHAR_CAP}, then a summary only.
 */
export function formatEditResult(input: EditResultInput): string {
	const { relPath, absolutePath, fileExisted, userEdits, autoFormattingEdits, newProblemsMessage } = input
	const finalContent = input.finalContent
	const problems = newProblemsMessage ?? ""
	const header = pathHeader(relPath, absolutePath)

	// Nothing to describe (save produced no content) — keep the old minimal confirmation.
	if (finalContent === undefined) {
		return `The content was successfully saved to ${toPosix(relPath)}.\n\n${autoFormattingSection(autoFormattingEdits)}${problems}`
	}

	const totalLines = countLines(finalContent)

	if (!fileExisted) {
		return formatNewFileResult({ header, relPath, finalContent, totalLines, autoFormattingEdits, problems })
	}

	// The pre-edit content comes straight off disk (CRLF on Windows) while finalContent is
	// EOL-normalised by the diff view; without this every line would read as changed.
	const originalContent = normalizeEol(input.originalContent ?? "")
	const normalizedFinal = normalizeEol(finalContent)
	const applied = unifiedDiff(relPath, originalContent, normalizedFinal)
	const rel = toPosix(relPath)

	const parts: string[] = []
	if (userEdits) {
		parts.push(
			`The user modified your proposed content before approving it. Their changes:\n\n` +
				`<user_edits path="${rel}">\n${capText(userEdits, DIFF_CHAR_CAP, "user edits")}\n</user_edits>\n`,
		)
		parts.push(`The saved file therefore includes BOTH your edit and the user's changes — do not re-apply either.\n`)
	}

	parts.push(`The edit was saved to ${header}. The file is now ${totalLines} lines.\n`)

	if (applied.trim().length === 0) {
		parts.push(`No net change: the file content is identical to before the edit.\n`)
	} else {
		parts.push(
			`Applied change (unified diff, old → new):\n\n<applied_diff path="${rel}">\n${capText(applied, DIFF_CHAR_CAP, "diff")}\n</applied_diff>\n`,
		)

		const windows = changedLineWindows(originalContent, normalizedFinal)
		if (windows.length > 0) {
			const regions = capText(renderChangedRegions(normalizedFinal, windows), REGIONS_CHAR_CAP, "context")
			parts.push(
				`Post-edit context (±${CONTEXT_WINDOW_LINES} lines around each change, with line numbers):\n\n` +
					`<changed_regions path="${rel}" total_lines="${totalLines}">\n${regions}\n</changed_regions>\n`,
			)
		}
	}

	const formatting = autoFormattingSection(autoFormattingEdits)
	if (formatting) {
		parts.push(formatting.trimEnd() + "\n")
	}

	parts.push(EDIT_APPLIED_SENTENCE)

	return `${parts.join("\n")}\n${problems}`
}

function formatNewFileResult(args: {
	header: string
	relPath: string
	finalContent: string
	totalLines: number
	autoFormattingEdits?: string
	problems: string
}): string {
	const { header, relPath, finalContent, totalLines, autoFormattingEdits, problems } = args
	const rel = toPosix(relPath)
	const formatting = autoFormattingSection(autoFormattingEdits)

	if (finalContent.length > NEW_FILE_ECHO_CHAR_CAP) {
		return (
			`The file was created at ${header} — ${totalLines} lines, ${finalContent.length} characters. ` +
			`The content is not echoed back because you authored it in this same call.\n\n` +
			formatting +
			`${EDIT_APPLIED_SENTENCE}\n${problems}`
		)
	}

	return (
		`The file was created at ${header} — ${totalLines} lines.\n\n` +
		formatting +
		`<final_file_content path="${rel}">\n${finalContent}\n</final_file_content>\n\n` +
		`${EDIT_APPLIED_SENTENCE}\n${problems}`
	)
}
