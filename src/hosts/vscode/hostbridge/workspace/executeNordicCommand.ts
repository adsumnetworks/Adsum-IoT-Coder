import * as fs from "node:fs"
import * as vscode from "vscode"
import { buildJLinkArgs, getJLinkBinaryName, resolveJLinkBinary, type SupportedPlatform } from "./jlinkResolver"

export interface ExecuteNordicCommandRequest {
	command: string
}

export interface ExecuteNordicCommandResponse {
	success: boolean
	extensionFound: boolean
	error?: string
}

export interface ExecuteInNordicTerminalRequest {
	command: string
}

export interface ExecuteInNordicTerminalResponse {
	success: boolean
	terminalFound: boolean
	terminalCreated: boolean
	error?: string
}

/**
 * Execute a Nordic nRF Connect SDK command via VS Code.
 * This abstraction allows the handler to avoid direct vscode API usage.
 */
export async function executeNordicCommand(request: ExecuteNordicCommandRequest): Promise<ExecuteNordicCommandResponse> {
	try {
		// Check if the nRF Connect extension is available
		const extension = vscode.extensions.getExtension("nordic-semiconductor.nrf-connect")

		if (!extension) {
			return {
				success: false,
				extensionFound: false,
				error: `nRF Connect Extension not detected. Please install the "nRF Connect Extension Pack" for the best experience.`,
			}
		}

		// Execute the VS Code command
		await vscode.commands.executeCommand(request.command)

		return {
			success: true,
			extensionFound: true,
		}
	} catch (error) {
		return {
			success: false,
			extensionFound: true,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Check if a terminal name indicates an nRF/Nordic terminal.
 * Matches: "nRF $(icons) v3.2.1", "nRF Connect", "NCS Terminal", etc.
 */
function isNordicTerminalName(name: string): boolean {
	const lowerName = name.toLowerCase()
	return (
		lowerName.startsWith("nrf") || // Matches "nRF $(icons)..." and "nrf-*"
		lowerName.includes("nordic") ||
		lowerName.includes("zephyr") ||
		lowerName.includes("ncs")
	)
}

/**
 * Find an existing nRF Connect terminal by name patterns.
 * IMPORTANT: This function ONLY returns terminals that are confirmed nRF/Nordic terminals.
 * It does NOT fallback to regular shells - that would break the SDK environment.
 */
export function findNordicTerminal(): vscode.Terminal | undefined {
	const terminals = vscode.window.terminals
	if (terminals.length === 0) {
		return undefined
	}

	// Find first terminal matching Nordic patterns
	for (const terminal of terminals) {
		if (isNordicTerminalName(terminal.name)) {
			return terminal
		}
	}

	// IMPORTANT: Do NOT fallback to activeTerminal or any other terminal!
	// Regular shells don't have the SDK environment variables set.
	// Returning undefined will trigger creation of a proper nRF terminal.
	return undefined
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Create the nRF Connect shell terminal and return it by REFERENCE — identified by
 * diffing `vscode.window.terminals` (plus `onDidOpenTerminal`) rather than by name.
 *
 * Why not match by name: the nRF Connect terminal's name is built dynamically and
 * has changed across extension releases (e.g. 2026.6.x no longer matches our
 * historical "nrf/zephyr/ncs" patterns), so name-matching a *freshly created*
 * terminal is unreliable and was the cause of "Failed to activate nRF Connect
 * Terminal" even though the terminal had clearly opened. The new terminal is simply
 * the one that wasn't there before the create command — whatever it is called.
 *
 * Returns undefined if the extension is absent or no new terminal appears in time.
 */
async function createNordicTerminalByDiff(): Promise<vscode.Terminal | undefined> {
	const extension = vscode.extensions.getExtension("nordic-semiconductor.nrf-connect")
	if (!extension) {
		return undefined
	}

	const before = new Set(vscode.window.terminals)
	let opened: vscode.Terminal | undefined
	const disposable = vscode.window.onDidOpenTerminal((t) => {
		if (!before.has(t)) {
			opened = opened ?? t
		}
	})

	try {
		// "Create Shell Terminal" — the NCS shell with the SDK environment active.
		await vscode.commands.executeCommand("nrf-connect.createNcsTerminal")

		// POLL up to 15s. Prefer the event-captured terminal; otherwise diff the list.
		for (let i = 0; i < 30; i++) {
			await delay(500)
			const appeared = opened ?? vscode.window.terminals.find((t) => !before.has(t))
			if (appeared) {
				return appeared
			}
		}
	} finally {
		disposable.dispose()
	}

	return undefined
}

/**
 * Execute a command in the nRF Connect terminal.
 * If no nRF terminal exists, creates one first.
 */
export async function executeInNordicTerminal(request: ExecuteInNordicTerminalRequest): Promise<ExecuteInNordicTerminalResponse> {
	try {
		// Fast path: reuse an existing nRF terminal we can recognize by name.
		let terminal = findNordicTerminal()
		let terminalCreated = false

		// Otherwise create one and capture it by reference (name-agnostic).
		if (!terminal) {
			terminal = await createNordicTerminalByDiff()
			terminalCreated = !!terminal

			if (!terminal) {
				return {
					success: false,
					terminalFound: false,
					terminalCreated: false,
					error: "Could not find or create nRF Connect terminal. Please open an nRF Connect terminal manually.",
				}
			}
		}

		// Show the terminal and execute the command
		terminal.show()
		terminal.sendText(request.command, true)

		return {
			success: true,
			terminalFound: true,
			terminalCreated,
		}
	} catch (error) {
		return {
			success: false,
			terminalFound: false,
			terminalCreated: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Activate/create the nRF Connect terminal without executing a command.
 * This ensures the SDK environment is active for subsequent commands.
 */
export async function activateNordicTerminal(): Promise<string | undefined> {
	// Priority 1: reuse an existing nRF terminal we can recognize by name.
	let terminal = findNordicTerminal()
	if (terminal) {
		terminal.show()
		return terminal.name
	}

	// Priority 2: create one and capture it by REFERENCE (diff + onDidOpenTerminal),
	// not by name — the new nRF Connect extension names its terminal in a way our
	// historical name patterns miss, which is exactly what made activation "fail"
	// even though the terminal opened.
	terminal = await createNordicTerminalByDiff()
	if (terminal) {
		terminal.show()
		return terminal.name
	}

	// If we still can't find it, log the running terminals to help debugging.
	const visibleTerminals = vscode.window.terminals.map((t) => t.name).join(", ")
	console.warn(`[Nordic] Failed to find nRF terminal after creation attempts. Visible terminals: ${visibleTerminals}`)

	return undefined
}

// ============================================================
// RTT AUTOMATION FUNCTIONS
// ============================================================

export interface RTTConnectionResult {
	success: boolean
	method: "plan_a" | "plan_b" | "none"
	error?: string
	terminalName?: string
}

/**
 * Connect to RTT using Plan A: VS Code nRF Terminal command.
 * This triggers the nRF Terminal extension's RTT connection.
 * Note: May show GUI picker if device selection is needed.
 */
export async function connectRTTPlanA(): Promise<RTTConnectionResult> {
	try {
		// Check if nRF Terminal extension is available
		const terminalExt = vscode.extensions.getExtension("nordic-semiconductor.nrf-terminal")
		if (!terminalExt) {
			return {
				success: false,
				method: "plan_a",
				error: "nRF Terminal extension not found. Install the nRF Connect Extension Pack.",
			}
		}

		// Try the nRF Terminal command with RTT connection type
		await vscode.commands.executeCommand("nrf-terminal.startTerminal", { connectionType: "rtt" })

		// Wait for terminal to appear
		await new Promise((resolve) => setTimeout(resolve, 2000))

		// Check if an RTT terminal was created
		const rttTerminal = vscode.window.terminals.find(
			(t) => t.name.toLowerCase().includes("rtt") || t.name.toLowerCase().includes("terminal"),
		)

		if (rttTerminal) {
			rttTerminal.show()
			return {
				success: true,
				method: "plan_a",
				terminalName: rttTerminal.name,
			}
		}

		return {
			success: false,
			method: "plan_a",
			error: "RTT terminal was not created. User may have cancelled device selection.",
		}
	} catch (error) {
		return {
			success: false,
			method: "plan_a",
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Connect to RTT using Plan B: spawn the SEGGER J-Link interactive CLI directly.
 *
 * Cross-platform behavior:
 * - Windows uses `JLink.exe`, macOS/Linux use `JLinkExe` (SEGGER's naming).
 * - We invoke the binary directly via VS Code's `createTerminal({ shellPath,
 *   shellArgs })`. No shell wrapper (`/bin/bash`, `cmd /c`) — that means no
 *   quoting concerns and the same code path works on every OS.
 * - Binary location is resolved by walking deterministic install paths,
 *   versioned SEGGER directories, then PATH. If nothing is found we fail
 *   loudly with a useful error rather than letting VS Code silently spawn
 *   the wrong thing.
 *
 * @param serialNumber - Device serial number from `nrfjprog --ids`
 * @param deviceName - Target device (default: nRF52840_xxAA)
 * @param rttPort - RTT telnet port (default: 19021)
 */
export async function connectRTTPlanB(
	serialNumber: string,
	deviceName: string = "nRF52840_xxAA",
	rttPort: number = 19021,
): Promise<RTTConnectionResult> {
	try {
		const terminalName = `RTT (${serialNumber})`

		const existingTerminal = vscode.window.terminals.find((t) => t.name === terminalName)
		if (existingTerminal) {
			existingTerminal.show()
			return {
				success: true,
				method: "plan_b",
				terminalName: existingTerminal.name,
			}
		}

		const platform = process.platform as SupportedPlatform
		const jlinkPath = resolveJLinkBinary(platform, process.env, fs.existsSync, (dir) => fs.readdirSync(dir))

		if (!jlinkPath) {
			const binaryName = getJLinkBinaryName(platform)
			return {
				success: false,
				method: "plan_b",
				error:
					`Could not locate ${binaryName}. Install SEGGER J-Link from ` +
					"https://www.segger.com/downloads/jlink/ or add it to PATH.",
			}
		}

		const terminal = vscode.window.createTerminal({
			name: terminalName,
			shellPath: jlinkPath,
			shellArgs: buildJLinkArgs({ deviceName, serialNumber, rttPort }),
		})

		terminal.show()

		// Give J-Link a moment to connect before the caller assumes the
		// terminal is live (e.g. before issuing follow-up RTT reads).
		await new Promise((resolve) => setTimeout(resolve, 3000))

		return {
			success: true,
			method: "plan_b",
			terminalName: terminal.name,
		}
	} catch (error) {
		return {
			success: false,
			method: "plan_b",
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Try to connect to RTT automatically.
 * First tries Plan A (VS Code command), falls back to Plan B (JLinkExe) if that fails.
 * @param serialNumber - Optional serial number for Plan B fallback
 * @param deviceName - Optional device name for Plan B fallback
 */
export async function connectRTT(serialNumber?: string, deviceName?: string): Promise<RTTConnectionResult> {
	// Try Plan A first
	const planAResult = await connectRTTPlanA()
	if (planAResult.success) {
		return planAResult
	}

	// If Plan A failed and we have serial number, try Plan B
	if (serialNumber) {
		console.log("[Nordic] Plan A RTT failed, attempting Plan B with JLinkExe...")
		return await connectRTTPlanB(serialNumber, deviceName)
	}

	// Neither worked
	return {
		success: false,
		method: "none",
		error: `Plan A failed: ${planAResult.error}. Plan B requires serial number.`,
	}
}
