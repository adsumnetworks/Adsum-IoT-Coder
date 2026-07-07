import { existsSync } from "node:fs"
import path from "node:path"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { scanForVerdictLeaks } from "@services/knowledge/honesty/verdictScan"
import { findLast, parsePartialArrayString } from "@shared/array"
import { ClineAsk, ClineAskQuestion } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import { telemetryService } from "@/services/telemetry"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { readinessReportOnDisk } from "./AttemptCompletionHandler"

/** Exit-shaped option shapes banned in a CRA run's asks — both TERMINAL ("I'm done", "that's all") and
 *  PAUSE ("I'll continue later", "Save & come back", "review offline"). Kept tight to true session-exit
 *  phrasings so legitimate per-thread declines ("skip this CVE — show me the posture gaps") never trip. */
const CRA_EXIT_OPTION_RE =
	/\b(i'?ll (continue|come back( to (this|it))?) later|come back later|i'?m (all )?done|that'?s (all|it)( for (now|today))?|wrap (it |this )?up|review (it |this )?offline|done for (now|today|the day)|end (the |this )?(run|session|task|chat)|close (the |this )?(run|session|task)|nothing else (for now|right now|today)|maybe later|not right now)\b/i

export class AskFollowupQuestionToolHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.ASK

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.question}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const question = block.params.question || ""
		const optionsRaw = block.params.options || "[]"
		const sharedMessage = {
			question: uiHelpers.removeClosingTag(block, "question", question),
			options: parsePartialArrayString(uiHelpers.removeClosingTag(block, "options", optionsRaw)),
		} satisfies ClineAskQuestion

		await uiHelpers.ask("followup" as ClineAsk, JSON.stringify(sharedMessage), block.partial).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const question: string | undefined = block.params.question
		const optionsRaw: string | undefined = block.params.options

		// Validate required parameter
		if (!question) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "question")
		}

		// CRA resting-ask guards (operator direction: a CRA run never ends — the open ask IS the session's
		// resting state, so it inherits the duties the completion guards used to hold). Scoped to CRA runs
		// (SBOM emitted or report written); every other ask is untouched.
		if (config.taskState.craReadinessReportWritten || config.taskState.craSbomEmitted) {
			const options = parsePartialArrayString(optionsRaw || "[]")
			// 0) Write-before-present + twin nets, moved here from the completion seam (which a CRA run no longer
			//    reaches): a CLOSING ask — one that presents the report/counts — requires the report on disk and
			//    its machine-readable twin next to it. Mirrors the old completion guards; on-disk evidence
			//    overrides a reset in-memory flag (workspace switch) so this never false-blocks.
			const looksLikeClosingAsk = /CRA_READINESS\.md|report (written|saved) to|full report:/i.test(question)
			if (looksLikeClosingAsk) {
				if (!config.taskState.craReadinessReportWritten && !readinessReportOnDisk(config.cwd)) {
					config.taskState.consecutiveMistakeCount++
					return formatResponse.toolError(
						"This closing question claims a report, but no CRA readiness report cleared the write seam — " +
							"write the full report to `compliance/cra-<date>/CRA_READINESS.md` with the write_to_file " +
							"tool FIRST (the honesty guard runs only there; never inline, never a shell redirect), " +
							"then re-send this question.",
					)
				}
				if (config.taskState.craReadinessReportWritten && config.taskState.craReadinessReportDir) {
					const twin = path.join(config.taskState.craReadinessReportDir, "cra-readiness.json")
					if (!existsSync(twin)) {
						config.taskState.consecutiveMistakeCount++
						return formatResponse.toolError(
							`This CRA run wrote the report but not its machine-readable twin. Write ${twin} with ` +
								`write_to_file (same folder as CRA_READINESS.md) — it carries the structured components / ` +
								`CVE findings / posture and is mandatory on every platform. Then re-send this question.`,
						)
					}
				}
			}
			// 1) No exit-shaped options — terminal OR pause. A real run offered "I'll continue later"; clicking
			//    it ended the session. The developer leaves by simply leaving; the ask stays open for their return.
			const exitShaped = options.filter((o) => CRA_EXIT_OPTION_RE.test(o))
			if (exitShaped.length > 0) {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError(
					`These options are exit-shaped and banned in a CRA run: ${exitShaped.map((o) => `"${o}"`).join(", ")}. ` +
						"Never offer leaving — no 'I'm done' / 'that's all' (terminal) and no 'I'll continue later' / " +
						"'Save & come back' (pause) either. Re-send the question with FORWARD moves only (triage the " +
						"next CVE · enable the next posture gap · open your project & run it live · re-scan · save a " +
						"copy). The developer who wants to stop simply stops; this question stays on screen as the " +
						"session's resting state.",
				)
			}
			// 2) Evidence-mode at the resting seam: the closing ask now carries the counts/summary the completion
			//    used to carry, and it is just as unguarded — scan it like the completion was (S2).
			const leaks = scanForVerdictLeaks(`${question}\n${options.join("\n")}`)
			if (leaks.length > 0) {
				const samples = [...new Set(leaks.map((l) => l.match))].slice(0, 5).join(", ")
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError(
					`This question uses verdict-style status (${samples}${leaks.length > 5 ? ", …" : ""}). The ask is ` +
						"evidence-mode too — no ✅/⚠️/❌/✓, no PASS/Clean/Strong/fixed, no scorecard fragments. State " +
						"the literal counts + the report path + forward options, never a verdict.",
				)
			}
		}
		config.taskState.consecutiveMistakeCount = 0

		// In yolo mode, don't wait for user input - instruct AI to use tools instead
		if (config.yoloModeToggled) {
			// Log the question that was asked but auto-respond
			await config.callbacks.say(
				"info",
				`[YOLO MODE] Auto-responding to question: "${question.substring(0, 100)}${question.length > 100 ? "..." : ""}"`,
			)

			return formatResponse.toolResult(
				`[YOLO MODE: User input is not available in non-interactive mode. You must use available tools (read_file, list_files, search_files, etc.) to gather the information you need instead of asking the user. Proceed with using tools to find the answer to your question: "${question}"]`,
			)
		}

		// Show notification if enabled
		if (config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Adsum IoT Coder has a question...",
				message: question.replace(/\n/g, " "),
			})
		}

		const sharedMessage = {
			question: question,
			options: parsePartialArrayString(optionsRaw || "[]"),
		} satisfies ClineAskQuestion

		const options = parsePartialArrayString(optionsRaw || "[]")

		// Ask the question
		const {
			text,
			images,
			files: followupFiles,
		} = await config.callbacks.ask("followup", JSON.stringify(sharedMessage), false)

		// Check if options contains the text response
		if (optionsRaw && text && options.includes(text)) {
			telemetryService.captureOptionSelected(config.ulid, options.length, "act")

			// Valid option selected, update last followup message with selected option
			const clineMessages = config.messageState.getClineMessages()
			const lastFollowupMessage = findLast(clineMessages, (m: any) => m.ask === "followup")
			if (lastFollowupMessage) {
				lastFollowupMessage.text = JSON.stringify({
					...sharedMessage,
					selected: text,
				} satisfies ClineAskQuestion)
				await config.messageState.saveClineMessagesAndUpdateHistory()
			}
		} else {
			// Option not selected, send user feedback
			telemetryService.captureOptionsIgnored(config.ulid, options.length, "act")
			await config.callbacks.say("user_feedback", text ?? "", images, followupFiles)
		}

		// Process any attached files
		let fileContentString = ""
		if (followupFiles && followupFiles.length > 0) {
			fileContentString = await processFilesIntoText(followupFiles)
		}

		return formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images, fileContentString)
	}
}
