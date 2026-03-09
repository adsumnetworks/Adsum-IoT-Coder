import * as path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as vscode from "vscode"
import { activateNordicTerminal } from "@/hosts/vscode/hostbridge/workspace/executeNordicCommand"
import { getCachedCapabilities } from "@/platform/nordicProjectDetector"

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
 *
 * IMPORTANT: This handler bypasses the CommandExecutor pipeline entirely.
 * The nRF terminal is a 3rd-party terminal managed by the Nordic extension,
 * which NEVER has VS Code shell integration. The CommandExecutor pipeline
 * (shellIntegration → timeout → clipboard fallback → ask() blocking)
 * is fundamentally incompatible with it and causes the agent to hang forever.
 * Instead, we use terminal.sendText() + file-based output capture (Tee-Object/tee).
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

		// ENFORCE: Block build/flash commands — agent must NOT do these
		const lowerCommand = command.toLowerCase().trim()
		if (lowerCommand.includes("west build") || lowerCommand.includes("west flash")) {
			const errorMessage =
				"BUILD/FLASH operations are NOT allowed via this tool. " +
				"Please tell the user: 'To build or flash, use the nRF Connect Extension directly (Build/Flash buttons in the sidebar).'"
			await config.callbacks.say("error", errorMessage)
			return formatResponse.toolError(errorMessage)
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

		// ROBUST TRANSPORT DETECTION with explicit user input priority
		if (!transport) {
			// Step 1 (PRIORITY): Check port/devices format FIRST (explicit user intent)
			const isRttSerial = (id: string) => /^\d{9,12}$/.test(id.trim())
			const isUartPort = (id: string) => {
				const upperId = id.toUpperCase()
				return upperId.startsWith("COM") || upperId.includes("TTY") || upperId.includes("/DEV/")
			}

			if (port && isRttSerial(port)) {
				transport = "rtt"
				console.log(`[Nordic Transport] Detected RTT (serial format): ${port}`)
			} else if (port && isUartPort(port)) {
				transport = "uart"
				console.log(`[Nordic Transport] Detected UART (port format): ${port}`)
			} else if (devices && devices.split(",").some((d: string) => isRttSerial(d.split(":")[1] || ""))) {
				transport = "rtt"
				console.log(`[Nordic Transport] Detected RTT (serial in devices parameter)`)
			} else if (devices && devices.split(",").some((d: string) => isUartPort(d.split(":")[1] || ""))) {
				transport = "uart"
				console.log(`[Nordic Transport] Detected UART (port format in devices parameter)`)
			}

			// Step 2 (FALLBACK): Check project capabilities from prj.conf ONLY IF port format didn't lock it in
			if (!transport && config.cwd) {
				try {
					const capabilities = getCachedCapabilities(config.cwd)
					transport = capabilities.recommendedTransport

					console.log(`[Nordic Transport] Detected from prj.conf: ${transport.toUpperCase()}`)
					console.log(`[Nordic Project] RTT: ${capabilities.hasRTT}, UART: ${capabilities.hasUART}`)
					if (capabilities.configPath) {
						console.log(`[Nordic Config] Using: ${capabilities.configPath}`)
					}
				} catch (error) {
					console.warn("[Nordic Transport] Could not detect from prj.conf, will use fallback")
					transport = null
				}
			}

			// Step 3 (DEFAULT): If still no transport determined, default to UART (most common)
			if (!transport) {
				transport = "uart"
				console.log(`[Nordic Transport] No detection results, defaulting to UART (most common)`)
			}
		} else {
			console.log(`[Nordic Transport] Explicitly set by agent: ${transport.toUpperCase()}`)
		}

		if (!operation) {
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "operation")
		}

		// 1b. Handle "device_info" operation
		if (operation === "device_info") {
			const serialNumber = port || (devices ? devices.split(",")[0].split(":")[1] : undefined)
			if (!serialNumber) {
				return formatResponse.toolError("Operation 'device_info' requires 'port' (serial number) parameter.")
			}

			const cmd = `nrfutil device device-info --serial-number ${serialNumber}`

			await config.callbacks.say(
				"tool",
				JSON.stringify({
					tool: "triggerNordicAction",
					path: `Nordic Device Info [${serialNumber}]`,
				}),
			)

			return this.executeInNrfTerminal(config, cmd)
		}

		// 1. Handle "list" operation via nRF terminal (ensures nrfutil is available)
		if (operation === "list") {
			await config.callbacks.say(
				"tool",
				JSON.stringify({
					tool: "triggerNordicAction",
					path: `Nordic Logger: list devices`,
				}),
			)
			return this.executeInNrfTerminal(config, "nrfutil device list")
		}

		// 2. Resolve paths for "capture" / "test" / "monitor"

		// Determine which wrapper script to use based on transport
		let wrapperName = transport === "rtt" ? "rtt-logger" : "uart-logger"

		// Add .bat extension on Windows, use as-is on Unix
		const isWindows = process.platform === "win32"
		if (isWindows) {
			wrapperName = wrapperName + ".bat"
		}

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

		// On Windows, quote the path if it contains spaces
		if (isWindows && wrapperPath.includes(" ")) {
			wrapperPath = `"${wrapperPath}"`
		}

		const args = [wrapperPath]

		// B. Output Path: Ensure it is ABSOLUTE to avoid saving in wrong CWD
		let resolvedOutput = output
		if (output && !path.isAbsolute(output)) {
			if (config.cwd) {
				resolvedOutput = path.join(config.cwd, output)
			}
		}

		// Ensure transport-specific subfolder is used
		if (resolvedOutput && transport) {
			const transportPath = transport.toLowerCase()
			if (
				!resolvedOutput.toLowerCase().endsWith(transportPath) &&
				!resolvedOutput.toLowerCase().endsWith(transportPath + path.sep)
			) {
				resolvedOutput = path.join(resolvedOutput, transportPath)
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
				args.push("--capture")
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

	/**
	 * Execute a command strictly inside the nRF terminal environment.
	 *
	 * Uses a two-step approach:
	 * 1. Activate/create nRF Connect terminal (guarantees correct SDK environment/PATH variables).
	 * 2. Execute command using standard executeCommandTool, explicitly passing the terminalName.
	 */
	private async executeInNrfTerminal(config: TaskConfig, command: string): Promise<ToolResponse> {
		// Step 1: Ensure nRF terminal is active (creates if needed, sets up SDK env)
		let terminalName: string | undefined
		try {
			// This returns the name of the nRF terminal (e.g. "nRF Connect")
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

		// Step 2: Execute command specifically in the named nRF terminal, suppressing missing shell integration warnings natively
		const [userRejected, result] = await config.callbacks.executeCommandTool(command, undefined, terminalName, true)

		if (userRejected) {
			config.taskState.didRejectTool = true
		}

		return result
	}
}
