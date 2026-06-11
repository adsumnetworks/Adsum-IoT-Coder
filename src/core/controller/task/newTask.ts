import {
	buildDemoDisplayText,
	buildDemoPrompt,
	classifyDemoCapability,
	DEMO_TRIGGER,
	prepareDemoWorkspace,
} from "@core/demos/DemoManager"
import { getInstallId } from "@services/adsum/InstallIdentity"
import { telemetryService } from "@services/telemetry"
import { String } from "@shared/proto/cline/common"
import { PlanActMode, OpenaiReasoningEffort as ProtoOpenaiReasoningEffort } from "@shared/proto/cline/state"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { Settings } from "@shared/storage/state-keys"
import { getCachedNrfEnvironment } from "@/services/nrf/EnvironmentDetector"
import { convertProtoToApiProvider } from "@/shared/proto-conversions/models/api-configuration-conversion"
import { DEFAULT_BROWSER_SETTINGS } from "../../../shared/BrowserSettings"
import { Controller } from ".."

/**
 * Creates a new task with the given text and optional images
 * @param controller The controller instance
 * @param request The new task request containing text and optional images, and optional task settings
 * @returns Empty response
 */
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<String> {
	const convertOpenaiReasoningEffort = (effort: ProtoOpenaiReasoningEffort): string => {
		switch (effort) {
			case ProtoOpenaiReasoningEffort.LOW:
				return "low"
			case ProtoOpenaiReasoningEffort.MEDIUM:
				return "medium"
			case ProtoOpenaiReasoningEffort.HIGH:
				return "high"
			case ProtoOpenaiReasoningEffort.MINIMAL:
				return "minimal"
			default:
				return "medium"
		}
	}

	const convertPlanActMode = (mode: PlanActMode): string => {
		return mode === PlanActMode.PLAN ? "plan" : "act"
	}

	const filteredTaskSettings: Partial<Settings> = Object.fromEntries(
		Object.entries({
			...request.taskSettings,
			...(request.taskSettings?.autoApprovalSettings && {
				autoApprovalSettings: (() => {
					// Merge with global settings to ensure complete settings for new task
					const globalSettings = controller.stateManager.getGlobalSettingsKey("autoApprovalSettings")
					const incomingSettings = request.taskSettings.autoApprovalSettings
					return {
						...globalSettings,
						...(incomingSettings.version !== undefined && { version: incomingSettings.version }),
						...(incomingSettings.enableNotifications !== undefined && {
							enableNotifications: incomingSettings.enableNotifications,
						}),
						actions: {
							...globalSettings.actions,
							...(incomingSettings.actions
								? Object.fromEntries(Object.entries(incomingSettings.actions).filter(([_, v]) => v !== undefined))
								: {}),
						},
					}
				})(),
			}),
			...(request.taskSettings?.browserSettings && {
				browserSettings: {
					viewport: request.taskSettings.browserSettings.viewport || DEFAULT_BROWSER_SETTINGS.viewport,
					remoteBrowserHost: request.taskSettings.browserSettings.remoteBrowserHost,
					remoteBrowserEnabled: request.taskSettings.browserSettings.remoteBrowserEnabled,
					chromeExecutablePath: request.taskSettings.browserSettings.chromeExecutablePath,
					disableToolUse: request.taskSettings.browserSettings.disableToolUse,
					customArgs: request.taskSettings.browserSettings.customArgs,
				},
			}),
			...(request.taskSettings?.openaiReasoningEffort !== undefined && {
				openaiReasoningEffort: convertOpenaiReasoningEffort(request.taskSettings.openaiReasoningEffort),
			}),
			...(request.taskSettings?.mode !== undefined && {
				mode: convertPlanActMode(request.taskSettings.mode),
			}),
			...(request.taskSettings?.customPrompt === "compact" && {
				customPrompt: "compact",
			}),
			...(request.taskSettings?.planModeApiProvider !== undefined && {
				planModeApiProvider: convertProtoToApiProvider(request.taskSettings.planModeApiProvider),
			}),
			...(request.taskSettings?.actModeApiProvider !== undefined && {
				actModeApiProvider: convertProtoToApiProvider(request.taskSettings.actModeApiProvider),
			}),
			...(request.taskSettings?.hooksEnabled !== undefined && {
				hooksEnabled: (() => {
					const isEnabled = !!request.taskSettings.hooksEnabled

					// Platform validation: Only allow enabling hooks on macOS and Linux
					if (isEnabled && process.platform === "win32") {
						// Expert fix: Don't throw, just disable and warn to avoid breaking the UI flow
						console.warn("Hooks are not yet supported on Windows, disabling for this task")
						return false
					}

					return isEnabled
				})(),
			}),
		}).filter(([_, value]) => value !== undefined),
	)

	// Demo intercept: replace the lightweight trigger with a real prompt pointing
	// at actual source files and RTT logs copied into globalStorage.
	let taskText = request.text
	// Friendly bubble text shown in place of the full runbook (kept out of the user's view).
	let displayText: string | undefined
	if (taskText.includes(DEMO_TRIGGER)) {
		try {
			const ws = await prepareDemoWorkspace()
			const env = getCachedNrfEnvironment()
			const capability = classifyDemoCapability(env)
			taskText = buildDemoPrompt(ws, capability, env)
			displayText = buildDemoDisplayText()
			telemetryService.captureFreeTierDemoRunStarted(getInstallId(), "nus-uart")
			// Consume the one-shot auto-start flag (set by the announcement toast CTA) so the demo
			// doesn't re-trigger on the next launch.
			controller.stateManager.setGlobalState("demoAutoStart", undefined)
			// Demo files live in globalStorage (outside the workspace) — auto-approve reads for this
			// task only. Does not touch the user's global auto-approval settings.
			const existingApproval =
				filteredTaskSettings.autoApprovalSettings ?? controller.stateManager.getGlobalSettingsKey("autoApprovalSettings")
			filteredTaskSettings.autoApprovalSettings = {
				...existingApproval,
				actions: { ...existingApproval.actions, readFilesExternally: true },
			}
		} catch (err) {
			console.error("[Demo] workspace preparation failed, falling back to original prompt:", err)
			// taskText stays as-is; the inline fallback logs in demoScenarios.ts still work
		}
	}

	const taskId = await controller.initTask(
		taskText,
		request.images,
		request.files,
		undefined,
		filteredTaskSettings,
		displayText,
	)
	return String.create({ value: taskId || "" })
}
