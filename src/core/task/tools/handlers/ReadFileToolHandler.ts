import fs from "node:fs/promises"
import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { HostProvider } from "@/hosts/host-provider"
import { isRegistryReachable, loadBitByKbPath } from "@/services/knowledge/KnowledgeResolver"
import { telemetryService } from "@/services/telemetry"
import { ClineSayTool } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ReadFileToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.FILE_READ

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		const config = uiHelpers.getConfig()

		// Create and show partial UI message
		const sharedMessageProps = {
			tool: "readFile",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: undefined,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)

		// Handle auto-approval vs manual approval for partial
		if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, relPath)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const relPath: string | undefined = block.params.path

		// Extract provider information for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		// Check clineignore access
		const accessValidation = this.validator.checkClineIgnorePath(relPath!)
		if (!accessValidation.ok) {
			await config.callbacks.say("clineignore_error", relPath)
			return formatResponse.toolError(formatResponse.clineIgnoreError(relPath!))
		}

		config.taskState.consecutiveMistakeCount = 0

		// Resolve the absolute path based on multi-workspace configuration
		const pathResult = resolveWorkspacePath(config, relPath!, "ReadFileToolHandler.execute")
		const { absolutePath, displayPath } =
			typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relPath! } : pathResult

		// Determine workspace context for telemetry
		const fallbackAbsolutePath = path.resolve(config.cwd, relPath ?? "")
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: typeof pathResult !== "string", // multi-root path result indicates hint usage
			resolvedToNonPrimary: !arePathsEqual(absolutePath, fallbackAbsolutePath),
			resolutionMethod: (typeof pathResult !== "string" ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		// Handle approval flow
		const sharedMessageProps = {
			tool: "readFile",
			path: getReadablePath(config.cwd, displayPath),
			content: absolutePath,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath!),
		} satisfies ClineSayTool

		const completeMessage = JSON.stringify(sharedMessageProps)

		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relPath)) {
			// Auto-approval flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

			// Capture telemetry
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		} else {
			// Manual approval flow
			const notificationMessage = `Adsum IoT Coder wants to read ${getWorkspaceBasename(absolutePath, "ReadFileToolHandler.notification")}`

			// Show notification
			showNotificationForApproval(notificationMessage, config.autoApprovalSettings.enableNotifications)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					provider,
					false,
					false,
					workspaceContext,
					block.isNativeToolCall,
				)
				return formatResponse.toolDenied()
			} else {
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					provider,
					false,
					true,
					workspaceContext,
					block.isNativeToolCall,
				)
			}
		}

		// Run PreToolUse hook after approval but before execution
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

		// Pre-flight guard for nRF log captures: the model often guesses a
		// log filename before capture has run (or before the timestamp is
		// known). Returning the raw "File not found" makes the agent loop
		// retrying with similar-looking paths. Surface a structured hint
		// pointing back to the capture flow instead.
		if (isLikelyCapturedLogPath(absolutePath)) {
			const exists = await fileAccessible(absolutePath)
			if (!exists) {
				return formatResponse.toolError(
					`Log file not found at ${displayPath}. ` +
						`If you are trying to read freshly-captured device logs, first run nrf_device_tool ` +
						`with action="log_device" and operation="capture", then use list_files on the ` +
						`enclosing logs/ directory to discover the newly-created filename — timestamps in ` +
						`filenames vary, so do not assume a path.`,
				)
			}
		}

		// No-double-load guard: iot-knowledge skill files don't change during a task, and many are
		// pre-loaded into the system prompt. If the agent re-reads one it already pulled this task
		// (bundled OR downloaded), return a short stub instead of the full text to save context.
		const knowledgeRoot = path.join(HostProvider.get().extensionFsPath, "iot-knowledge")
		const isKnowledgeFile = absolutePath.startsWith(knowledgeRoot + path.sep)
		if (isKnowledgeFile && config.taskState.loadedKnowledgeFiles.has(absolutePath)) {
			return (
				`${displayPath} is already in your context (loaded earlier this task) — not re-reading. ` +
				`Refer to the copy already above; iot-knowledge files do not change during a task.`
			)
		}

		// P2.5: un-bundled on-demand K-bit. If a bundled-tree (iot-knowledge) path isn't on disk, it may
		// be a DOWNLOADED bit — resolve it through the registry (cache → fetch → hash-verify) so the
		// agent's on-demand `read_file <kbDir>/…/X.md` still works for downloaded workflows/actions.
		// Self-guarded (returns null for non-iot-knowledge paths) and only runs when the file is missing,
		// so it has no effect on normal reads.
		if (absolutePath.includes("iot-knowledge") && !(await fileAccessible(absolutePath))) {
			const bitBody = await loadBitByKbPath(absolutePath)
			if (bitBody) {
				if (isKnowledgeFile) {
					config.taskState.loadedKnowledgeFiles.add(absolutePath)
				}
				await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")
				return bitBody
			}
			// Couldn't resolve this knowledge bit. Give a clear, actionable reason instead of a bare
			// "file not found": a downloaded bit when the registry is unreachable, vs. a wrong path.
			const reachable = await isRegistryReachable()
			return formatResponse.toolError(
				reachable
					? `Knowledge bit not found: "${displayPath}". It is not bundled and not in the registry — ` +
							`double-check the path (combine the iot-knowledge directory with the bit's relative path).`
					: `Could not load knowledge bit "${displayPath}": the Adsum knowledge registry is unreachable ` +
							`and this bit is not cached locally. Check your network connection and retry. ` +
							`(Bundled knowledge is unaffected.)`,
			)
		}

		// Bundled/on-disk knowledge file: mark it loaded before the read so a re-read this task stubs out.
		if (isKnowledgeFile) {
			config.taskState.loadedKnowledgeFiles.add(absolutePath)
		}

		// Execute the actual file read operation
		const supportsImages = config.api.getModel().info.supportsImages ?? false
		const fileContent = await extractFileContent(absolutePath, supportsImages)

		// Track file read operation
		await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")

		// Handle image blocks separately - they need to be pushed to userMessageContent
		if (fileContent.imageBlock) {
			config.taskState.userMessageContent.push(fileContent.imageBlock)
		}

		return fileContent.text
	}
}

const LOG_PATH_PATTERN = /(^|[\\/])logs[\\/](rtt|uart|hci|btmon|monitor)[\\/].+\.(log|btmon)$/i

function isLikelyCapturedLogPath(absolutePath: string): boolean {
	return LOG_PATH_PATTERN.test(absolutePath)
}

async function fileAccessible(absolutePath: string): Promise<boolean> {
	try {
		await fs.access(absolutePath)
		return true
	} catch {
		return false
	}
}
