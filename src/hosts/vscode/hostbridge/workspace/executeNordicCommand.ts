import * as vscode from "vscode"

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

/**
 * Execute a command in the nRF Connect terminal.
 * If no nRF terminal exists, creates one first.
 */
export async function executeInNordicTerminal(request: ExecuteInNordicTerminalRequest): Promise<ExecuteInNordicTerminalResponse> {
	try {
		let terminal = findNordicTerminal()
		let terminalCreated = false

		// If no nRF terminal found, try to create one
		if (!terminal) {
			// Check if nRF Connect extension is available
			const extension = vscode.extensions.getExtension("nordic-semiconductor.nrf-connect")

			if (extension) {
				// Create nRF Connect terminal via extension command
				await vscode.commands.executeCommand("nrf-connect.createNcsTerminal")

				// Wait a bit for terminal to be created
				await new Promise((resolve) => setTimeout(resolve, 1500))

				// Try to find the newly created terminal
				terminal = findNordicTerminal()
				terminalCreated = true
			}

			// If still no terminal, fallback to finding any terminal or inform user
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
	let terminal = findNordicTerminal()

	// Priority 2: If we already have an nRF terminal, just use it (no need to create new)
	if (terminal) {
		terminal.show()
		return terminal.name
	}

	// No nRF terminal found, try to create one
	const extension = vscode.extensions.getExtension("nordic-semiconductor.nrf-connect")
	if (extension) {
		await vscode.commands.executeCommand("nrf-connect.createNcsTerminal")

		// POLL: Wait for terminal to be created and registered
		// Try 30 times with 500ms delay (total 15s)
		for (let i = 0; i < 30; i++) {
			await new Promise((resolve) => setTimeout(resolve, 500))
			terminal = findNordicTerminal()
			if (terminal) break
		}
	}

	// Show/focus the terminal
	if (terminal) {
		terminal.show()
		return terminal.name
	}

	// If we still can't find it, log the running terminals to help debugging
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
 * Connect to RTT using Plan B: Spawn JLinkExe directly.
 * This requires the serial number and device name.
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
		// Create a terminal for JLink RTT
		const terminalName = `RTT (${serialNumber})`

		// Check if we already have this RTT terminal
		const existingTerminal = vscode.window.terminals.find((t) => t.name === terminalName)
		if (existingTerminal) {
			existingTerminal.show()
			return {
				success: true,
				method: "plan_b",
				terminalName: existingTerminal.name,
			}
		}

		// Find JLinkExe path (common locations)
		const jlinkPaths = [
			"/opt/SEGGER/JLink/JLinkExe",
			"/usr/bin/JLinkExe",
			"JLinkExe", // Rely on PATH
		]

		// Create terminal with JLink command
		const terminal = vscode.window.createTerminal({
			name: terminalName,
			shellPath: "/bin/bash",
			shellArgs: [
				"-c",
				`echo "Connecting to RTT on device ${serialNumber}..." && ` +
					`JLinkExe -device ${deviceName} -SelectEmuBySN ${serialNumber} ` +
					`-if swd -speed auto -AutoConnect 1 -RTTTelnetPort ${rttPort}`,
			],
		})

		terminal.show()

		// Give JLink time to connect
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
