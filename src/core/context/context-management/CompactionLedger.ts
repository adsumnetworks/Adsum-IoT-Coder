import type { ClineMessage } from "@/shared/ExtensionMessage"

/**
 * Deterministic task-state ledger, prepended to the context-truncation notice at compaction time.
 *
 * Why deterministic: the models that hit compaction hardest are the small ones (glm-5-turbo class),
 * and asking a small model to summarize 200K+ tokens it is about to lose is how the "269-byte
 * boilerplate handoff" happened. This ledger is assembled from the UI message history by code, so
 * it is identical on every model and cannot hallucinate. Measured motivation: a real gateway task
 * lost 254 of 272 messages (93.4%) at compaction with only that boilerplate surviving, and the
 * agent then re-asked already-settled questions ("which observation method?") up to 11× per run.
 *
 * Everything here is best-effort extraction — every section is optional and the whole ledger is
 * hard-capped so it can never itself become a context problem.
 */

const SECTION_CAPS = {
	progress: 500,
	command: 160,
	error: 240,
	guidance: 200,
	total: 2_000,
} as const

const LOG_PATH_RE = /[\w./\\:~-]*logs[/\\][\w./-]+\.(?:log|btmon|txt)/gi

function firstLine(text: string): string {
	const nl = text.indexOf("\n")
	return nl >= 0 ? text.slice(0, nl) : text
}

function clip(text: string, cap: number): string {
	const t = text.trim()
	return t.length <= cap ? t : `${t.slice(0, cap - 1)}…`
}

function lastDistinct<T>(items: T[], n: number): T[] {
	const seen = new Set<T>()
	const out: T[] = []
	for (let i = items.length - 1; i >= 0 && out.length < n; i--) {
		if (!seen.has(items[i])) {
			seen.add(items[i])
			out.push(items[i])
		}
	}
	return out.reverse()
}

export function buildCompactionLedger(clineMessages: ClineMessage[]): string {
	const progress: string[] = []
	const commands: string[] = []
	const errors: string[] = []
	const capturePaths: string[] = []
	const editedFiles: string[] = []
	const guidance: string[] = []

	for (const m of clineMessages) {
		const text = m.text || ""
		if (!text) {
			continue
		}
		if (m.type === "say") {
			switch (m.say) {
				case "task_progress":
					progress.push(text)
					break
				case "command":
					commands.push(firstLine(text))
					break
				case "error":
					errors.push(firstLine(text))
					break
				case "user_feedback":
					guidance.push(firstLine(text))
					break
				case "tool": {
					try {
						const t = JSON.parse(text)
						if ((t.tool === "editedExistingFile" || t.tool === "newFileCreated") && t.path) {
							editedFiles.push(String(t.path))
						}
					} catch {
						// not JSON — ignore
					}
					break
				}
				default:
					break
			}
		}
		// Capture-log paths can appear in any message (command output, tool results, asks)
		for (const match of text.matchAll(LOG_PATH_RE)) {
			capturePaths.push(match[0])
		}
	}

	const sections: string[] = []

	const lastProgress = progress[progress.length - 1]
	if (lastProgress) {
		sections.push(`Task progress checklist (latest):\n${clip(lastProgress, SECTION_CAPS.progress)}`)
	}
	const lastCommands = lastDistinct(commands, 3)
	if (lastCommands.length) {
		sections.push(`Recent commands:\n${lastCommands.map((c) => `- ${clip(c, SECTION_CAPS.command)}`).join("\n")}`)
	}
	const lastError = errors[errors.length - 1]
	if (lastError) {
		sections.push(`Last error seen:\n${clip(lastError, SECTION_CAPS.error)}`)
	}
	const lastCaptures = lastDistinct(capturePaths, 3)
	if (lastCaptures.length) {
		sections.push(
			`Capture/log files on disk (searchable with search_files):\n${lastCaptures.map((p) => `- ${p}`).join("\n")}`,
		)
	}
	const lastEdits = lastDistinct(editedFiles, 5)
	if (lastEdits.length) {
		sections.push(`Files edited this task:\n${lastEdits.map((p) => `- ${p}`).join("\n")}`)
	}
	const lastGuidance = lastDistinct(guidance, 2)
	if (lastGuidance.length) {
		sections.push(
			`Recent user guidance (verbatim):\n${lastGuidance.map((g) => `- "${clip(g, SECTION_CAPS.guidance)}"`).join("\n")}`,
		)
	}

	if (!sections.length) {
		return ""
	}

	const ledger =
		`TASK STATE LEDGER (auto-generated from the task history at compaction — deterministic, not a model summary):\n\n` +
		sections.join("\n\n")
	return clip(ledger, SECTION_CAPS.total)
}
