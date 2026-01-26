import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { activateNordicTerminal } from "@/hosts/vscode/hostbridge/workspace/executeNordicCommand"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * Handler for executing commands in the nRF Connect terminal.
 * This is the PRIMARY method for Nordic/Zephyr development tasks.
 *
 * Uses a two-step approach:
 * 1. Activate/create nRF Connect terminal (ensures correct SDK environment)
 * 2. Execute command using standard CommandExecutor (captures output)
 */
export class TriggerNordicActionHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.NORDIC_ACTION

	getDescription(block: ToolUse): string {
		const command = block.params.command
		if (command) {
			// Truncate long commands for display
			const displayCmd = command.length > 50 ? command.substring(0, 47) + "..." : command
			return `[nRF Terminal: ${displayCmd}]`
		}
		return `[nRF Terminal]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// No partial handling needed for this tool
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const action: string | undefined = block.params.action
		const command: string | undefined = block.params.command

		// Validate action is "execute"
		if (!action || action.toLowerCase() !== "execute") {
			config.taskState.consecutiveMistakeCount++
			const errorMessage = `Invalid action '${action}'. Use action="execute" with command parameter.`
			await config.callbacks.say("error", errorMessage)
			return formatResponse.toolError(errorMessage)
		}

		// Validate command parameter
		if (!command) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "command")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Inform the user with properly formatted tool message
		await config.callbacks.say(
			"tool",
			JSON.stringify({
				tool: "triggerNordicAction",
				path: command,
			}),
		)

		// Step 1: Ensure nRF terminal is active (creates if needed)
		// This sets up the correct SDK environment
		try {
			await activateNordicTerminal()
		} catch (error) {
			// Non-fatal: continue with command execution
			// The terminal might already be active or user might be in CLI mode
			console.warn("Could not activate nRF terminal:", error)
		}

		// Step 2: Execute command using the standard CommandExecutor
		// This provides full output capture and streaming
		const [userRejected, result] = await config.callbacks.executeCommandTool(command, undefined)

		if (userRejected) {
			config.taskState.didRejectTool = true
		}

		return result
	}
}
