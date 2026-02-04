import { exec } from "node:child_process"
import * as path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as vscode from "vscode"
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
 * It supports two modes:
 * 1. "execute": Runs generic commands in the nRF terminal (ensures correct SDK environment).
 * 2. "log_device": Runs the embedded nrf_logger.py script using internal path resolution.
 */
export class TriggerNordicActionHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.NORDIC_ACTION

	constructor(private context: vscode.ExtensionContext) {}

	getDescription(block: ToolUse): string {
		const action = block.params.action
		if (action === "log_device") {
			const operation = block.params.operation || "unknown"
			return `[Nordic Logger: ${operation}]`
		}

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

		// 1. Handle "log_device" action (The Pro Way)
		if (action === "log_device") {
			return this.handleLogDevice(config, block)
		}

		// 2. Handle "execute" action (The Generic Way)
		const command: string | undefined = block.params.command

		// Validate action is "execute"
		if (!action || action.toLowerCase() !== "execute") {
			config.taskState.consecutiveMistakeCount++
			const errorMessage = `Invalid action '${action}'. Use action="execute" with command parameter, or action="log_device" with operation parameter.`
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

		return this.executeInNrfTerminal(config, command)
	}

	private async handleLogDevice(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const operation = block.params.operation
		let { port, duration, devices, output, reset, auto_detect, list_nrf, transport } = block.params as any

		// FOOLPROOF: Smart transport detection if agent forgets to set it
		if (!transport) {
			const isRttSerial = (id: string) => /^\d{9}$/.test(id.trim())
			if (port && isRttSerial(port)) {
				transport = "rtt"
			} else if (devices && devices.split(",").some((d: string) => isRttSerial(d.split(":")[1] || ""))) {
				transport = "rtt"
			}
		}

		if (!operation) {
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "operation")
		}

		// 1. Handle "list" operation internally (Hidden "Under the Hood")
		if (operation === "list") {
			return this.listDevicesInternal(transport)
		}

		// 2. Resolve paths for "capture" / "test" / "monitor"

		// Determine which wrapper script to use based on transport
		const wrapperName = transport === "rtt" ? "rtt-logger" : "uart-logger"

		// A. Script Path: Use relative path for cleaner terminal output
		const absoluteWrapperPath = path.join(this.context.extensionUri.fsPath, "assets", "scripts", wrapperName)
		let wrapperPath = absoluteWrapperPath

		// Try to make it relative to the current working directory (workspace root)
		if (config.cwd) {
			const workspaceRoot = config.cwd
			try {
				const relativePath = path.relative(workspaceRoot, absoluteWrapperPath)
				// If relative path is shorter and doesn't traverse too far up, use it
				if (!relativePath.startsWith("..") && relativePath.length < absoluteWrapperPath.length) {
					wrapperPath = "./" + relativePath
				}
			} catch (e) {
				// Fallback to absolute
			}
		}

		const args = [wrapperPath]

		// B. Output Path: Ensure it is ABSOLUTE to avoid saving in wrong CWD
		let resolvedOutput = output
		if (output && !path.isAbsolute(output)) {
			if (config.cwd) {
				resolvedOutput = path.join(config.cwd, output)
			}
		}

		switch (operation) {
			case "test":
				if (port) {
					args.push("--test", "--port", port)
				} else {
					return formatResponse.toolError("Operation 'test' requires 'port' parameter.")
				}
				break
			case "capture":
				// CRITICAL: rtt-logger requires --capture flag, but uart-logger (UART) fails with it!
				// Only add it if we are using RTT transport.
				if (transport === "rtt") {
					args.push("--capture")
				}
				// Helper to check for truthiness including string "false"
				const isAutoDetect = auto_detect === true || auto_detect === "true"
				const isResetDisabled = reset === false || reset === "false"

				if (isAutoDetect) {
					args.push("--auto-detect")
					// Reset is DEFAULT for auto-detect unless explicitly disabled
					if (isResetDisabled) {
						args.push("--no-reset")
					}
				} else {
					// Manual port or devices specification
					if (port) args.push("--port", port)
					if (devices) args.push("--devices", devices)

					// Validate: either port or devices must be present
					if (!port && !devices) {
						return formatResponse.toolError(
							"Operation 'capture' requires either 'port', 'devices', or 'auto_detect' parameter.",
						)
					}

					// Reset is DEFAULT unless explicitly disabled
					if (isResetDisabled) {
						args.push("--no-reset")
					}
				}

				if (duration) args.push("--duration", duration.toString())
				if (resolvedOutput) args.push("--output", resolvedOutput)
				break
			case "monitor":
				// Monitor maps to undefined (default behavior of script if no duration?)
				// or maybe we don't support infinite monitor in this tool due to timeout?
				// For now, treat monitor same as capture but verify duration constraints if needed.
				if (port) args.push("--port", port)
				// Monitor implies interactive or long running.
				// We'll let the script decide defaults.
				break
			default:
				return formatResponse.toolError(`Unknown operation '${operation}' for log_device.`)
		}

		// Execute wrapper directly (no python3 prefix!)
		const cmd = args.join(" ")

		config.taskState.consecutiveMistakeCount = 0

		await config.callbacks.say(
			"tool",
			JSON.stringify({
				tool: "triggerNordicAction",
				path: `Nordic Logger [${(transport || "uart").toUpperCase()}]: ${operation}`,
			}),
		)

		// Execute using the same NRF terminal logic to ensure python environment is okay
		// (Though python might be system wide, NRF terminal is safer for consistency)
		return this.executeInNrfTerminal(config, cmd)
	}

	private async listDevicesInternal(transport?: string): Promise<ToolResponse> {
		// Select the appropriate script based on transport
		const scriptName = transport === "rtt" ? "nrf_rtt_logger.py" : "nrf_uart_logger.py"
		const scriptPath = path.join(this.context.extensionUri.fsPath, "assets", "scripts", scriptName)
		const cmd = `python3 "${scriptPath}" --list`

		return new Promise((resolve) => {
			exec(cmd, (error, stdout, stderr) => {
				if (error) {
					// Fallback if python fails
					return resolve(
						formatResponse.toolError(`Failed to list devices via python script: ${error.message}\n${stderr}`),
					)
				}

				// The script output is already human-readable and contains Ports + Serials
				// e.g. "/dev/ttyACM0 ... Serial: 683..."
				const output = stdout.trim()

				if (!output || output.includes("No nRF devices found")) {
					return resolve([
						{
							type: "text",
							text: "No connected nRF devices found.",
						},
					])
				}

				resolve([
					{
						type: "text",
						text: output,
					},
				])
			})
		})
	}

	private async executeInNrfTerminal(config: TaskConfig, command: string): Promise<ToolResponse> {
		// Step 1: Ensure nRF terminal is active (creates if needed)
		let terminalName: string | undefined
		try {
			terminalName = await activateNordicTerminal()
		} catch (error) {
			console.warn("Could not activate nRF terminal:", error)
		}

		if (!terminalName) {
			const errorMessage =
				"Failed to activate nRF Connect Terminal. Please ensure the 'nRF Connect' extension is installed and you can open a terminal matching 'nRF' or 'Zephyr' manually."
			await config.callbacks.say("error", errorMessage)
			return formatResponse.toolError(errorMessage)
		}

		// Step 2: Execute command
		const [userRejected, result] = await config.callbacks.executeCommandTool(command, undefined, terminalName)

		if (userRejected) {
			config.taskState.didRejectTool = true
		}

		return result
	}
}
