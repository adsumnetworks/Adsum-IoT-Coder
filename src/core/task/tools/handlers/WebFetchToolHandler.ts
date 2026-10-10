import { ClineAsk, ClineSayTool } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import axios from "axios"
import { ClineEnv } from "@/config"
import { AuthService } from "@/services/auth/AuthService"
import { buildClineExtraHeaders } from "@/services/EnvUtils"
import { featureFlagsService } from "@/services/feature-flags"
import { telemetryService } from "@/services/telemetry"
import {
	FETCH_MAX_BYTES,
	FETCH_TIMEOUT_MS,
	fenceFetched,
	htmlToText,
	isPrivateUrl,
	isVendorUrl,
} from "@/services/web/vendorFetch"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@/shared/ClineAccount"
import { getAxiosSettings } from "@/shared/net"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class WebFetchToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.WEB_FETCH

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.url}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const url = block.params.url || ""
		const sharedMessageProps: ClineSayTool = {
			tool: "webFetch",
			path: uiHelpers.removeClosingTag(block, "url", url),
			content: `Fetching URL: ${uiHelpers.removeClosingTag(block, "url", url)}`,
			operationIsLocatedInWorkspace: false, // web_fetch is always external
		} satisfies ClineSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		// For partial blocks, we'll let the ToolExecutor handle auto-approval logic
		// Just stream the UI update for now
		await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
		await uiHelpers.ask("tool" as ClineAsk, partialMessage, block.partial).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const url: string | undefined = block.params.url
			const prompt: string | undefined = block.params.prompt

			// Extract provider information for telemetry
			const apiConfig = config.services.stateManager.getApiConfiguration()
			const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
			const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

			// Validate required parameters
			if (!url) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "url")
			}
			if (!prompt) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "prompt")
			}
			config.taskState.consecutiveMistakeCount = 0

			// The cloud road needs a cloud account, the user setting and the flag. [0.5 browsing] Without them
			// the fetch runs from this machine instead: vendor documentation under the session's auto-approve
			// rules, any other host only when the developer says yes to that call, private addresses never,
			// and the text comes back fenced as data.
			const clineWebToolsEnabled = config.services.stateManager.getGlobalSettingsKey("clineWebToolsEnabled")
			const featureFlagEnabled = featureFlagsService.getWebtoolsEnabled()
			const localRoad = provider !== "cline" || !clineWebToolsEnabled || !featureFlagEnabled
			if (localRoad && isPrivateUrl(url)) {
				return formatResponse.toolError(
					`${url} is a local or private address. web_fetch reads public documentation only; for a device on the bench use execute_command (curl) under its own guards.`,
				)
			}

			// Create message for approval
			const sharedMessageProps: ClineSayTool = {
				tool: "webFetch",
				path: url,
				content: `Fetching URL: ${url}`,
				operationIsLocatedInWorkspace: false,
			}
			const completeMessage = JSON.stringify(sharedMessageProps)

			if (config.callbacks.shouldAutoApproveTool(this.name) && (!localRoad || isVendorUrl(url))) {
				// Auto-approve flow
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
				telemetryService.captureToolUsage(
					config.ulid,
					"web_fetch",
					config.api.getModel().id,
					provider,
					true,
					true,
					undefined,
					block.isNativeToolCall,
				)
			} else {
				// Manual approval flow
				showNotificationForApproval(
					`Adsum IoT Coder wants to fetch content from ${url}`,
					config.autoApprovalSettings.enableNotifications,
				)
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
						undefined,
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
						undefined,
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

			if (localRoad) {
				const res = await axios.get<string>(url, {
					timeout: FETCH_TIMEOUT_MS,
					maxContentLength: FETCH_MAX_BYTES * 10,
					maxRedirects: 3,
					responseType: "text",
					headers: { Accept: "text/html, text/plain;q=0.9, */*;q=0.5" },
					validateStatus: () => true,
					...getAxiosSettings(),
				})
				if (res.status >= 400) {
					return formatResponse.toolError(`web_fetch: ${url} answered ${res.status}`)
				}
				const type = String(res.headers["content-type"] ?? "")
				const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data)
				const text = type.includes("html") ? htmlToText(body) : htmlToText(`<pre>${body}</pre>`)
				return formatResponse.toolResult(fenceFetched(url, prompt, text))
			}

			// Execute the actual fetch
			const baseUrl = ClineEnv.config().apiBaseUrl
			const authToken = await AuthService.getInstance().getAuthToken()

			if (!authToken) {
				throw new Error(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE)
			}

			const response = await axios.post(
				`${baseUrl}/api/v1/search/webfetch`,
				{
					Url: url,
					Prompt: prompt,
				},
				{
					headers: {
						Authorization: `Bearer ${authToken}`,
						"Content-Type": "application/json",
						"X-Task-ID": config.ulid || "",
						...(await buildClineExtraHeaders()),
					},
					timeout: 15000,
					...getAxiosSettings(),
				},
			)

			// Parse response
			// Axios will throw on non-200 status, so no need to check fetchStatus
			const result = response.data.data.result

			return formatResponse.toolResult(result)
		} catch (error) {
			return `Error fetching web content: ${(error as Error).message}`
		}
	}
}
