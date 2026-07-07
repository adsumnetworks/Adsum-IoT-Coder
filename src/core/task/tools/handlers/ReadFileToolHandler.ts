import fs from "node:fs/promises"
import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { HostProvider } from "@/hosts/host-provider"
import {
	bitIdForKbPath,
	deriveIdFromRel,
	downloadedBitKnown,
	isBareBitPath,
	isRegistryReachable,
	loadBitByKbPath,
	loadBitByRel,
	suggestNearMissBits,
} from "@/services/knowledge/KnowledgeResolver"
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
		let { absolutePath, displayPath } =
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

		// Recovery for a common agent mistake: the knowledge base's own cross-reference tables
		// (skill-loading.md, PLATFORM.md, …) show skill paths RELATIVE to the iot-knowledge root
		// (e.g. "platforms/nrf/workflows/debug-loop.md") even though the system prompt's CRITICAL
		// RULE asks for the full absolute path. When that happens, `relPath` resolves against the
		// WORKSPACE cwd instead and 404s before the P2.5 un-bundled-bit fallback below even gets a
		// chance to run (it only fires when absolutePath already contains "iot-knowledge"). Redirect
		// unconditionally (not gated on the file existing bundled-on-disk): P2.5's loadBitByKbPath
		// derives the bit id from the path string alone and tries bundled → cache → registry, so a
		// referenced-but-not-yet-bundled file (like debug-loop.md) still resolves correctly instead
		// of surfacing a confusing raw workspace "File not found". Only engages when the primary
		// resolution already failed, so it can't affect any normal (already-working) read.
		// …but NEVER re-root an ABSOLUTE path: a real Windows run read a missing user file
		// (c:/…/compliance/cra-<date>/CRA_READINESS.md), got re-rooted to "iot-knowledge/c:/…", and was told
		// "Knowledge bit not found" instead of a plain file-not-found. Only bare RELATIVE paths are skill refs.
		const looksAbsolute = (p: string) => path.isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p)
		const knowledgeRoot = path.join(HostProvider.get().extensionFsPath, "iot-knowledge")
		if (
			relPath &&
			!looksAbsolute(relPath) &&
			!absolutePath.startsWith(knowledgeRoot + path.sep) &&
			!(await fileAccessible(absolutePath))
		) {
			absolutePath = path.join(knowledgeRoot, relPath)
			displayPath = path.join("iot-knowledge", relPath)
		}

		// No-double-load guard: iot-knowledge skill files don't change during a task, and many are
		// pre-loaded into the system prompt. If the agent re-reads one it already pulled this task
		// (bundled OR downloaded), return a short stub instead of the full text to save context.
		const isKnowledgeFile = absolutePath.startsWith(knowledgeRoot + path.sep)
		if (isKnowledgeFile && config.taskState.loadedKnowledgeFiles.has(absolutePath)) {
			return (
				`${displayPath} is already in your context (loaded earlier this task) — not re-reading. ` +
				`Refer to the copy already above; iot-knowledge files do not change during a task.`
			)
		}

		// P2.5: un-bundled on-demand K-bit. A bundled-tree path that isn't on disk may be a DOWNLOADED
		// bit — resolve it through the registry (cache → fetch → hash-verify) so the agent's on-demand
		// `read_file <kbDir>/…/X.md` still works for downloaded workflows/actions. Two shapes:
		//   (a) absolute iot-knowledge path (already includes the dir), or
		//   (b) a BARE bundled-tree relative path (e.g. "platforms/nrf/workflows/debug-loop.md") that
		//       resolved against the workspace — without this it 404s and the agent retries the absolute
		//       path (the "file not found then recover" loop). Self-guarded to bit roots, only when missing.
		const isAbsKbPath = absolutePath.includes("iot-knowledge")
		const isBarePath = !isAbsKbPath && isBareBitPath(relPath)
		if ((isAbsKbPath || isBarePath) && !(await fileAccessible(absolutePath))) {
			let bitBody = isAbsKbPath ? await loadBitByKbPath(absolutePath) : await loadBitByRel(relPath!)
			if (!bitBody) {
				// Outer retry (field report: a CRA run on Windows hit a transient load failure at the FIRST
				// skill read and honestly stopped; a manual re-run worked). The RegistryClient already retries
				// 3× per HTTP call (~16s worst case) — this second full pass after a pause stretches tolerance
				// to cover brief server restarts/network blips without ever weakening the honest-stop fallback.
				// A failed manifest memo is dropped internally (manifestRevalidated=false), so this re-attempts
				// the whole chain: manifest → cache → blob.
				await new Promise((resolve) => setTimeout(resolve, 3000))
				bitBody = isAbsKbPath ? await loadBitByKbPath(absolutePath) : await loadBitByRel(relPath!)
			}
			if (bitBody) {
				if (isKnowledgeFile) {
					config.taskState.loadedKnowledgeFiles.add(absolutePath)
				}
				await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")
				// H9 (R3, 0607b): the UI labels this read with the requested bundled-tree path, which made a
				// registry-served bit look BUNDLED in transcripts (it misled a delivery-path review into
				// suspecting proprietary bits were shipped in the VSIX). State the true provenance in the
				// returned body so every transcript carries it.
				// H5-A (Track 2): the readiness workflow's no-project "bundled sample" option needs a REAL,
				// WRITABLE sample location — a registry-served bit has no extension folder to derive one from.
				// Serve the path WITH the bit: prepare the pre-built CRA bundle and append its location as host
				// context. Fail-open (bundle absent / not initialized → no line; the bit's card routing holds).
				let hostContext = ""
				if (/cra[\\/]workflows[\\/]cra-readiness\.md$/i.test(absolutePath)) {
					try {
						const { prepareCraBundle } = await import("@core/demos/DemoManager")
						const bundle = await prepareCraBundle("nrf")
						hostContext =
							`\n\n[Host context: pre-built nRF reference sample (writable copy) at: ${bundle} — ` +
							`scan-ready layout (sbom/all.spdx · zephyr/.config · zephyr/symbols.nm). For a no-project ` +
							`"bundled sample" run, use it via the Sample-run mode (live scan, no build needed).]`
					} catch {
						// DemoManager not initialized or bundle absent — fall back to the bit's card routing.
					}
				}
				return (
					`[Adsum knowledge bit — served ON DEMAND from the knowledge registry (or its local cache/dev folder); ` +
					`NOT read from the bundled extension tree. Requested as: ${displayPath}]\n\n` +
					bitBody +
					hostContext
				)
			}
			// Couldn't resolve this knowledge bit. Give a clear, actionable reason instead of a bare
			// "file not found", attributing the ACTUAL failure stage: (a) registry unreachable, (b) listed in
			// the catalog but the content fetch failed just now (transient — a real Windows field report got
			// the misleading "not found" wording for this case), or (c) genuinely not in the registry.
			const reachable = await isRegistryReachable()
			const bitId = isAbsKbPath ? bitIdForKbPath(absolutePath) : deriveIdFromRel(relPath!.replace(/\\/g, "/"))
			const listedButFetchFailed = reachable && bitId !== null && (await downloadedBitKnown(bitId))
			// Anti-fabrication guard (domain-agnostic): a required Adsum bit that won't load must NOT be
			// reconstructed from general knowledge, memory, or a prior report — that yields an ungrounded
			// result (observed: a CRA run improvised a whole assessment when cra-readiness was unavailable).
			// Allow ONE genuine path re-check (typo), but if the bit truly doesn't exist, stop honestly.
			const antiImprovise =
				` Do NOT reconstruct or improvise this Adsum workflow from general knowledge, memory, or a prior ` +
				`report — tell the developer the workflow is currently unavailable and stop.`
			if (listedButFetchFailed) {
				return formatResponse.toolError(
					`Knowledge bit "${displayPath}" IS in the registry catalog, but fetching its content just failed ` +
						`(a transient network/server blip — this is NOT a wrong path and NOT a missing bit). Retry the ` +
						`same read_file once; if it still fails, tell the developer the bit is temporarily unavailable ` +
						`and to retry in a minute.${antiImprovise}`,
				)
			}
			// Near-miss rescue (F5 1907 field failure): a run guessed `cra/rules/core.md` for `cra/core.md`,
			// retried the SAME wrong path twice, and dead-ended. The model can't list the catalog — the host can.
			// Same-basename matches only, so a genuine typo gets its correction in one round.
			const nearMisses = reachable ? await suggestNearMissBits(isAbsKbPath ? absolutePath : (relPath ?? "")) : []
			// UNAMBIGUOUS near-miss → don't bounce it back at all (operator 0707: "shouldn't it be done
			// automatically?"). Exactly one bit in the whole catalog has this filename, and the request is
			// already inside the knowledge namespace — serve that bit directly, labelled with both paths so
			// the transcript stays honest. Two+ matches stay an error (auto-picking would guess).
			if (nearMisses.length === 1) {
				const correctedRel = nearMisses[0]
				const correctedBody = await loadBitByRel(correctedRel)
				if (correctedBody) {
					const correctedAbs = path.join(HostProvider.get().extensionFsPath, "iot-knowledge", correctedRel)
					config.taskState.loadedKnowledgeFiles.add(correctedAbs)
					await config.services.fileContextTracker.trackFileContext(correctedRel, "read_tool")
					return (
						`[Adsum knowledge bit — path auto-corrected. You asked for "${displayPath}", which does not ` +
						`exist; the only catalog bit with that filename is "${correctedRel}", served below. Use ` +
						`"${correctedRel}" (exact) for any future read of this bit.]\n\n` +
						correctedBody
					)
				}
			}
			const pathHint =
				nearMisses.length > 0
					? `A bit with this FILENAME exists at a different path — you likely mis-derived the directory. ` +
						`Retry with the exact path: ${nearMisses.join("  or  ")}. `
					: `First re-check the path (combine the iot-knowledge directory with the bit's relative path). `
			return formatResponse.toolError(
				reachable
					? `Knowledge bit not found: "${displayPath}". It is not bundled and not in the registry. ` +
							pathHint +
							`If the bit genuinely does not exist,${antiImprovise} ` +
							`(Dev: set ADSUM_KBIT_LOCAL to load downloaded bits from disk, or publish the bit.)`
					: `Could not load knowledge bit "${displayPath}": the Adsum knowledge registry is unreachable ` +
							`and this bit is not cached locally. Check your network connection and retry.${antiImprovise} ` +
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
