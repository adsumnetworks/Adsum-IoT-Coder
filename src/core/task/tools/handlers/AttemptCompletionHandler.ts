import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import type Anthropic from "@anthropic-ai/sdk"
import { AdsumFreeHandler } from "@core/api/providers/adsum-free"
import type { ToolUse } from "@core/assistant-message"
import { detectDemoScenarioId } from "@core/demos/DemoManager"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { getInstallId } from "@services/adsum/InstallIdentity"
import { looksLikeCraReportContent, looksLikeInlineCraReport } from "@services/cra/reportIntegrity"
import { telemetryService } from "@services/telemetry"
import { findLastIndex } from "@shared/array"
import { COMPLETION_RESULT_CHANGES_FLAG } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import type { ToolResponse } from "../../index"
import { buildUserFeedbackContent } from "../../utils/buildUserFeedbackContent"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

/** The demo scenario id this task is completing (matched from the launch bubble text), or undefined if it's not
 *  a demo task. Drives `demo_run_completed` attribution across ALL scenarios — previously only NUS was detected. */
function completingDemoScenarioId(config: TaskConfig): string | undefined {
	const msgs = config.messageState.getClineMessages()
	for (const m of msgs) {
		if (m.type === "say" && m.say === "text" && m.text) {
			const id = detectDemoScenarioId(m.text)
			if (id) {
				return id
			}
		}
	}
	return undefined
}

/** True if a CRA readiness report already exists on disk under `<cwd>/compliance` (directly or in a `cra-*`
 *  run folder). The write-seam honesty guard (WriteToFileToolHandler) already validated any such file at write
 *  time, so on-disk evidence is enough to satisfy the completion guard's "was it actually written?" check.
 *  This prevents a false "presented but never wrote it" block when the in-memory `craReadinessReportWritten`
 *  flag was reset — e.g. the report was written in a prior turn, or a mid-session workspace-folder switch
 *  started a fresh task (a real ESP run was blocked 6× though CRA_READINESS.md existed on disk). */
function readinessReportOnDisk(cwd: string): boolean {
	try {
		const complianceDir = path.join(cwd, "compliance")
		if (!existsSync(complianceDir)) {
			return false
		}
		if (existsSync(path.join(complianceDir, "CRA_READINESS.md"))) {
			return true
		}
		for (const entry of readdirSync(complianceDir, { withFileTypes: true })) {
			if (entry.isDirectory() && existsSync(path.join(complianceDir, entry.name, "CRA_READINESS.md"))) {
				return true
			}
		}
	} catch {
		// Unreadable compliance dir → treat as "no report on disk" (the guard then behaves as before).
	}
	return false
}

export class AttemptCompletionHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.ATTEMPT

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for attempt_completion
	 * Matches the original conditional logic structure for command vs no-command cases
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const result = block.params.result
		const command = block.params.command

		if (!command) {
			// no command, still outputting partial result
			await uiHelpers.say(
				"completion_result",
				uiHelpers.removeClosingTag(block, "result", result),
				undefined,
				undefined,
				block.partial,
			)
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		// Validate required parameters
		if (!result) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "result")
		}

		// CRA write-seam seatbelt (2806e): the full readiness report must be WRITTEN via write_to_file (where the
		// honesty guard runs), never pasted inline into the completion. Block an inline report → force the guarded
		// write + a thin completion. Scoped to CRA-report-shaped text, so normal completions are unaffected.
		if (looksLikeInlineCraReport(result)) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				"This completion contains the full CRA readiness report inline. The report MUST be written to " +
					"`compliance/CRA_READINESS.md` with the `write_to_file` tool (the honesty guard runs ONLY there) " +
					"plus `compliance/cra-readiness.json` — never inline and never via a shell redirect. The completion/chat " +
					"is a THIN pointer: the at-a-glance counts, the one-line evidence legend, 'full report written to " +
					"<absolute path>', and one decline-able next step. Write the report via write_to_file, then call " +
					"attempt_completion again with only that thin summary.",
			)
		}

		// CRA completion seatbelt (design/31, from 2906c): a readiness run must leave a WRITTEN report, never a
		// chat-only dump. 2906c ran out of context, dumped the full posture preview into a `say` (so the inline
		// check above — which only sees the completion `result` — missed it), then completed thin: no
		// CRA_READINESS.md on disk, the honesty guard never ran. If the report cleared the guarded write seam this
		// task (`craReadinessReportWritten`), we're fine. Otherwise, if the completion result OR any run text looks
		// like report-shaped CRA content, refuse — the report is presented but unwritten. Fails open: if no CRA
		// content is anywhere, a normal completion is untouched.
		if (!config.taskState.craReadinessReportWritten) {
			const sayTexts = config.messageState
				.getClineMessages()
				.filter((m) => m.type === "say" && (m.say === "text" || m.say === "completion_result"))
				.map((m) => m.text ?? "")
			const presentedButUnwritten = looksLikeCraReportContent(result) || sayTexts.some(looksLikeCraReportContent)
			// On-disk evidence overrides the reset in-memory flag (prior turn / workspace switch) — don't false-block.
			if (presentedButUnwritten && !readinessReportOnDisk(config.cwd)) {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError(
					"This CRA readiness run presented the report (posture preview / readiness report content) but never " +
						"WROTE it to a file via write_to_file — so there is no record on disk and the honesty guard never ran. " +
						"Before completing: write the full report to `compliance/cra-<date>/CRA_READINESS.md` with the " +
						"write_to_file tool (the guard runs ONLY there), never inline and never via a shell redirect. If you are " +
						"low on context, writing the report file is the PRIORITY — the chat summary is optional. Then call " +
						"attempt_completion again with only a THIN pointer (at-a-glance counts, one-line evidence legend, " +
						"'full report written to <absolute path>', one decline-able next step).",
				)
			}
		}

		// CRA twin seatbelt (parity, 2906i): the skeleton mandates BOTH the readiness `.md` AND its machine-readable
		// twin `cra-readiness.json` in the same run folder — a real ESP run shipped only the `.md`, so the nRF/ESP
		// outputs diverged. Once a report cleared the write seam, refuse completion until the json twin is on disk next
		// to it. Fails open: only fires when we recorded a report dir AND the twin is genuinely absent.
		if (config.taskState.craReadinessReportWritten && config.taskState.craReadinessReportDir) {
			const twin = path.join(config.taskState.craReadinessReportDir, "cra-readiness.json")
			if (!existsSync(twin)) {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError(
					`This CRA readiness run wrote the report but not its machine-readable twin. Write ${twin} with ` +
						`write_to_file (the same folder as CRA_READINESS.md) — the JSON twin carries the structured ` +
						`components / CVE findings / posture so the report is auditable, and it is mandatory on every ` +
						`platform. Then call attempt_completion again.`,
				)
			}
		}

		config.taskState.consecutiveMistakeCount = 0

		// Run PreToolUse hook before execution
		try {
			const { ToolHookUtils } = await import("../utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return formatResponse.toolDenied()
			}
			throw error
		}

		// Show notification if enabled
		if (config.autoApprovalSettings.enableNotifications) {
			const maxLen = 200
			const notifyMsg = result.length > maxLen ? result.substring(0, maxLen) + "..." : result
			showSystemNotification({
				subtitle: "Task Completed",
				message: notifyMsg.replace(/\n/g, " "),
			})
		}

		const addNewChangesFlagToLastCompletionResultMessage = async () => {
			// Add newchanges flag if there are new changes to the workspace
			const hasNewChanges = await config.callbacks.doesLatestTaskCompletionHaveNewChanges()
			const clineMessages = config.messageState.getClineMessages()

			const lastCompletionResultMessageIndex = findLastIndex(clineMessages, (m: any) => m.say === "completion_result")
			const lastCompletionResultMessage =
				lastCompletionResultMessageIndex !== -1 ? clineMessages[lastCompletionResultMessageIndex] : undefined
			if (
				lastCompletionResultMessage &&
				lastCompletionResultMessageIndex !== -1 &&
				hasNewChanges &&
				!lastCompletionResultMessage.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG)
			) {
				await config.messageState.updateClineMessage(lastCompletionResultMessageIndex, {
					text: lastCompletionResultMessage.text + COMPLETION_RESULT_CHANGES_FLAG,
				})
			}
		}

		// Remove any partial completion_result message that may exist
		// Search backwards since other messages may have been inserted after the partial
		const clineMessages = config.messageState.getClineMessages()
		const partialCompletionIndex = findLastIndex(
			clineMessages,
			(m) => m.partial === true && m.type === "say" && m.say === "completion_result",
		)
		if (partialCompletionIndex !== -1) {
			const updatedMessages = [
				...clineMessages.slice(0, partialCompletionIndex),
				...clineMessages.slice(partialCompletionIndex + 1),
			]
			config.messageState.setClineMessages(updatedMessages)
			await config.messageState.saveClineMessagesAndUpdateHistory()
		}

		let commandResult: any
		const lastMessage = config.messageState.getClineMessages().at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask !== "command") {
				// haven't sent a command message yet so first send completion_result then command
				const completionMessageTs = await config.callbacks.say("completion_result", result, undefined, undefined, false)
				await config.callbacks.saveCheckpoint(true, completionMessageTs)
				await addNewChangesFlagToLastCompletionResultMessage()
				telemetryService.captureTaskCompleted(config.ulid)
				if (config.api instanceof AdsumFreeHandler) {
					telemetryService.captureFreeTierDebugCycleCompleted(getInstallId(), "free-default", 0)
				}
				const demoScenarioId = completingDemoScenarioId(config)
				if (demoScenarioId) {
					telemetryService.captureFreeTierDemoRunCompleted(getInstallId(), demoScenarioId)
				}
			} else {
				// we already sent a command message, meaning the complete completion message has also been sent
				await config.callbacks.saveCheckpoint(true)
			}

			// Attempt completion is a special tool where we want to update the focus chain list before the user provides response
			if (!block.partial && config.focusChainSettings.enabled) {
				await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
			}

			// complete command message - need to ask for approval
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("command", command, config)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}

			// User approved, execute the command
			const [userRejected, execCommandResult] = await config.callbacks.executeCommandTool(command!, undefined) // no timeout for attempt_completion command
			if (userRejected) {
				config.taskState.didRejectTool = true
				return execCommandResult
			}
			// user didn't reject, but the command may have output
			commandResult = execCommandResult
		} else {
			// Send the complete completion_result message (partial was already removed above)
			const completionMessageTs = await config.callbacks.say("completion_result", result, undefined, undefined, false)
			await config.callbacks.saveCheckpoint(true, completionMessageTs)
			await addNewChangesFlagToLastCompletionResultMessage()
			telemetryService.captureTaskCompleted(config.ulid)
			if (config.api instanceof AdsumFreeHandler) {
				telemetryService.captureFreeTierDebugCycleCompleted(getInstallId(), "free-default", 0)
			}
			const demoScenarioId = completingDemoScenarioId(config)
			if (demoScenarioId) {
				telemetryService.captureFreeTierDemoRunCompleted(getInstallId(), demoScenarioId)
			}
		}

		// we already sent completion_result says, an empty string asks relinquishes control over button and field
		// in case last command was interactive and in partial state, the UI is expecting an ask response. This ends the command ask response, freeing up the UI to proceed with the completion ask.
		if (config.messageState.getClineMessages().at(-1)?.ask === "command_output") {
			await config.callbacks.say("command_output", "")
		}

		if (!block.partial && config.focusChainSettings.enabled) {
			await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
		}

		// Run TaskComplete hook BEFORE presenting the "Start New Task" button
		// At this point we know: task is complete, checkpoint saved, result shown to user
		await this.runTaskCompleteHook(config, block)

		const { response, text, images, files: completionFiles } = await config.callbacks.ask("completion_result", "", false)
		const prefix = "[attempt_completion] Result: Done"
		if (response === "yesButtonClicked") {
			return prefix // signals to recursive loop to stop (for now this never happens since yesButtonClicked will trigger a new task)
		}

		await config.callbacks.say("user_feedback", text ?? "", images, completionFiles)

		// Run UserPromptSubmit hook when user provides post-completion feedback
		let hookContextModification: string | undefined
		if (text || (images && images.length > 0) || (completionFiles && completionFiles.length > 0)) {
			const userContentForHook = await buildUserFeedbackContent(text, images, completionFiles)

			const hookResult = await config.callbacks.runUserPromptSubmitHook(userContentForHook, "feedback")

			if (hookResult.cancel === true) {
				return formatResponse.toolDenied()
			}

			// Capture hook context modification to add to tool results
			hookContextModification = hookResult.contextModification
		}

		const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
		if (commandResult) {
			if (typeof commandResult === "string") {
				toolResults.push({
					type: "text",
					text: commandResult,
				})
			} else if (Array.isArray(commandResult)) {
				toolResults.push(...commandResult)
			}
		}

		if (text) {
			toolResults.push(
				{
					type: "text",
					text: "The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.",
				},
				{
					type: "text",
					text: `<feedback>\n${text}\n</feedback>`,
				},
			)
		}

		// Add hook context modification if provided
		if (hookContextModification) {
			toolResults.push({
				type: "text" as const,
				text: `<hook_context source="UserPromptSubmit">\n${hookContextModification}\n</hook_context>`,
			})
		}

		const fileContentString = completionFiles?.length ? await processFilesIntoText(completionFiles) : ""
		if (fileContentString) {
			toolResults.push({
				type: "text" as const,
				text: fileContentString,
			})
		}

		if (images && images.length > 0) {
			toolResults.push(...formatResponse.imageBlocks(images))
		}

		// Return the tool results as a complex response
		return [
			{
				type: "text" as const,
				text: prefix,
			},
			...toolResults,
		]
	}

	/**
	 * Runs the TaskComplete hook after user confirms task completion.
	 * This is a non-cancellable, observation-only hook similar to TaskCancel.
	 * Errors are logged but do not affect task completion.
	 */
	private async runTaskCompleteHook(config: TaskConfig, block: ToolUse): Promise<void> {
		const hooksEnabled = config.services.stateManager.getGlobalSettingsKey("hooksEnabled")
		if (!hooksEnabled) {
			return
		}

		try {
			const { executeHook } = await import("@core/hooks/hook-executor")

			await executeHook({
				hookName: "TaskComplete",
				hookInput: {
					taskComplete: {
						taskMetadata: {
							taskId: config.taskId,
							ulid: config.ulid,
							result: block.params.result || "",
							command: block.params.command || "",
						},
					},
				},
				isCancellable: false, // Non-cancellable - task is already complete
				say: config.callbacks.say,
				setActiveHookExecution: undefined, // Explicitly undefined for non-cancellable hooks
				clearActiveHookExecution: undefined, // Explicitly undefined for non-cancellable hooks
				messageStateHandler: config.messageState,
				taskId: config.taskId,
				hooksEnabled,
			})
		} catch (error) {
			// TaskComplete hook failed - non-fatal, just log
			console.error("[TaskComplete Hook] Failed (non-fatal):", error)
		}
	}
}
