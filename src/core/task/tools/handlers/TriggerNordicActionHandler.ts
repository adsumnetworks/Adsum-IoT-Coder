import * as fs from "node:fs"
import * as path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as vscode from "vscode"
import { prepareNordicExecution } from "@/hosts/vscode/hostbridge/workspace/executeNordicCommand"
import { getCachedCapabilities } from "@/platform/nordicProjectDetector"
import { formatHci } from "@/services/nrf/hci/format"
import { parseHci } from "@/services/nrf/hci/hciParser"
import { telemetryService } from "@/services/telemetry"

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
/** Workspace-scoped key remembering the NCS version the user chose for this project (ask-once). */
const NCS_VERSION_STATE_KEY = "adsum.nrf.ncsVersion"

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

		// Only Zephyr build tools need the NCS toolchain env (and thus a resolved version);
		// nrfutil/nrfjprog and process cleanup just run bare with nrfutil on PATH.
		return this.executeInAdsumNrfTerminal(config, block, command, {
			needsToolchain: this.commandNeedsToolchain(command),
		})
	}

	/**
	 * Does this command need the NCS toolchain environment (ZEPHYR_BASE, the SDK
	 * toolchain, west's venv)? ONLY the Zephyr build tools do. Everything else —
	 * `nrfutil` in all its forms (`device`, `sdk-manager`, `toolchain-manager`,
	 * `--version`), `nrfjprog`, and process cleanup — are standalone tools that only
	 * need to be on PATH (our terminal provides that). Gating those behind a resolved
	 * NCS version is wrong: e.g. `nrfutil toolchain-manager list` is how you DISCOVER
	 * what's installed, so it must never require something to already be installed.
	 */
	private commandNeedsToolchain(command: string): boolean {
		return /\bwest\b/i.test(command) || /\b(cmake|ninja|dtc|menuconfig|guiconfig)\b/i.test(command)
	}

	private async handleLogDevice(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const operation = block.params.operation
		let { port, duration, devices, output, reset, auto_detect, list_nrf, transport, monitor } = block.params as any

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

			return this.executeInAdsumNrfTerminal(config, block, cmd, { needsToolchain: false })
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
			return this.executeInAdsumNrfTerminal(config, block, "nrfutil device list", { needsToolchain: false })
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

		// Quote any argument that contains a space — on ALL platforms. A workspace path like
		// ".../Adsum IoT Coder/..." otherwise lets the shell split the command, so a relative
		// "./Adsum IoT Coder/.../rtt-logger" runs as `./Adsum` → "no such file or directory".
		const quoteIfNeeded = (s: string): string => (s.includes(" ") ? `"${s}"` : s)
		wrapperPath = quoteIfNeeded(wrapperPath)

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

		// True once we've added --monitor, so the post-capture step knows to decode the .btmon sidecar(s).
		let monitorOn = false

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
				if (resolvedOutput) args.push("--output", quoteIfNeeded(resolvedOutput))

				// HCI Monitor: dual-channel capture (text .log + binary .btmon). Pass --monitor when the agent
				// asked for it OR when the project's prj.conf has CONFIG_BT_DEBUG_MONITOR_RTT=y (safety net so
				// the host↔controller trace is never silently dropped). RTT only — the monitor rides RTT ch1.
				{
					const monitorExplicit = monitor === true || monitor === "true"
					const monitorAuto =
						!monitorExplicit && transport === "rtt" && !!config.cwd && getCachedCapabilities(config.cwd).hasMonitorRTT
					if (monitorExplicit || monitorAuto) {
						args.push("--monitor")
						monitorOn = true
						if (monitorAuto) {
							console.log("[Nordic] Auto-enabling --monitor (CONFIG_BT_DEBUG_MONITOR_RTT=y in prj.conf)")
						}
					}
				}
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

		// Logger wrappers run bare in our own terminal — no SDK toolchain needed, but they shell out
		// to `nrfutil device …` (reachable via the injected PATH / ADSUM_NRFUTIL). `isLoggerWrapper`
		// makes the resolver add the PowerShell call operator for the quoted wrapper path.
		const captureResult = await this.executeInAdsumNrfTerminal(config, block, cmd, {
			needsToolchain: false,
			isLoggerWrapper: true,
		})

		// Agent-first HCI: when we captured the BT Monitor stream, decode each raw .btmon into a
		// human- AND agent-readable .hci.log under logs/hci/, and tell the agent to read it. The capture
		// command has already finished (executeCommandTool blocks), so the .btmon files exist on disk.
		if (monitorOn && resolvedOutput && config.cwd) {
			const note = this.decodeMonitorCaptures(resolvedOutput, config.cwd)
			if (note) {
				return typeof captureResult === "string" ? `${captureResult}\n\n${note}` : captureResult
			}
		}
		return captureResult
	}

	/**
	 * Decode every raw `.btmon` in `captureDir` (the BT Monitor binary from RTT channel 1) into a
	 * human-readable `<base>.hci.log` under `<cwd>/logs/hci/`. Returns an agent-facing note listing the
	 * decoded files so the agent reads + correlates them with the app log. Best-effort: a bad/empty
	 * capture is reported, never thrown.
	 */
	private decodeMonitorCaptures(captureDir: string, cwd: string): string | undefined {
		let btmonFiles: string[]
		try {
			btmonFiles = fs
				.readdirSync(captureDir)
				.filter((f) => f.endsWith(".btmon"))
				.map((f) => path.join(captureDir, f))
		} catch {
			return undefined
		}
		if (btmonFiles.length === 0) {
			return undefined
		}

		const hciDir = path.join(cwd, "logs", "hci")
		try {
			fs.mkdirSync(hciDir, { recursive: true })
		} catch {
			// fall back to writing beside the .btmon if logs/hci can't be created
		}

		const decoded: string[] = []
		for (const btmon of btmonFiles) {
			try {
				const base = path.basename(btmon, ".btmon")
				const target = fs.existsSync(hciDir)
					? path.join(hciDir, `${base}.hci.log`)
					: path.join(captureDir, `${base}.hci.log`)
				// Skip .btmon already decoded (filenames are timestamped, so this keeps the note to THIS
				// capture instead of re-listing every prior capture in the folder).
				if (fs.existsSync(target)) {
					continue
				}
				const buf = fs.readFileSync(btmon)
				if (buf.length === 0) {
					continue
				}
				fs.writeFileSync(target, formatHci(parseHci(buf)), "utf8")
				decoded.push(target)
			} catch (e) {
				console.warn(`[Nordic HCI] decode failed for ${btmon}: ${e instanceof Error ? e.message : String(e)}`)
			}
		}

		if (decoded.length === 0) {
			return "HCI monitor was enabled but no frames were decoded (the .btmon capture may be empty — confirm CONFIG_BT_DEBUG_MONITOR_RTT=y and that BLE activity occurred during capture)."
		}
		const list = decoded.map((p) => `  - ${p}`).join("\n")
		return (
			`Decoded HCI monitor trace (host ↔ controller) written to:\n${list}\n` +
			`Read the .hci.log file(s), then present a SHORT readable summary in chat: a framing line, a key-frame ` +
			`timeline (only the frames that matter — not every frame, no raw hex), and your diagnosis correlated ` +
			`with the app log. Point the user to the full .hci.log for detail. The raw .btmon is kept for btmon/Wireshark.`
		)
	}

	/**
	 * Execute a Nordic command in OUR OWN "Adsum nRF" terminal, sourcing the NCS
	 * toolchain in the background (Tier 1) — falling back to a visible `toolchain
	 * launch` wrap (Tier 2) and finally the extension's nRF terminal (Tier 3). This
	 * replaces the old createNcsTerminal path that raced the version QuickPick.
	 *
	 * Version resolution for toolchain commands: explicit `ncs_version` param →
	 * persisted per-project choice → project pin → single install → ask once. When
	 * the agent supplies `ncs_version`, we persist it so future builds are silent.
	 */
	private async executeInAdsumNrfTerminal(
		config: TaskConfig,
		block: ToolUse,
		command: string,
		opts: { needsToolchain: boolean; isLoggerWrapper?: boolean },
	): Promise<ToolResponse> {
		const explicitVersion = (block.params as Record<string, string | undefined>).ncs_version
		const persistedVersion = this.context.workspaceState?.get<string>(NCS_VERSION_STATE_KEY)

		let prepared: Awaited<ReturnType<typeof prepareNordicExecution>>
		try {
			prepared = await prepareNordicExecution({
				body: command,
				needsToolchain: opts.needsToolchain,
				isLoggerWrapper: opts.isLoggerWrapper,
				explicitVersion,
				persistedVersion,
			})
		} catch (error) {
			const msg = `Failed to prepare the nRF terminal: ${error instanceof Error ? error.message : String(error)}`
			telemetryService.captureNordicActionError(config.ulid, "executeInAdsumNrfTerminal", msg)
			await config.callbacks.say("error", msg)
			return formatResponse.toolError(msg)
		}

		if (prepared.kind === "needsChoice" || prepared.kind === "error") {
			const msg = prepared.message
			telemetryService.captureNordicActionError(config.ulid, "executeInAdsumNrfTerminal", msg)
			await config.callbacks.say("error", msg)
			return formatResponse.toolError(msg)
		}

		// The agent made an explicit version choice that resolved — remember it for this project.
		if (explicitVersion && opts.needsToolchain) {
			await this.context.workspaceState?.update(NCS_VERSION_STATE_KEY, explicitVersion)
		}

		const { terminalName, command: finalCommand } = prepared.plan
		const [userRejected, result] = await config.callbacks.executeCommandTool(finalCommand, undefined, terminalName, true)

		if (userRejected) {
			telemetryService.captureNordicActionExecuted(config.ulid, "executeInAdsumNrfTerminal", {
				command: finalCommand,
				status: "rejected",
			})
		} else if (result.error) {
			telemetryService.captureNordicActionError(config.ulid, "executeInAdsumNrfTerminal", result.error)
		} else {
			telemetryService.captureNordicActionExecuted(config.ulid, "executeInAdsumNrfTerminal", {
				command: finalCommand,
				status: "success",
			})
		}

		return result
	}
}
