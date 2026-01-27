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
 * Find an existing nRF Connect terminal by name patterns.
 * Falls back to the most recently active terminal if no nRF terminal is found.
 */
function findNordicTerminal(): vscode.Terminal | undefined {
	const terminals = vscode.window.terminals
	if (terminals.length === 0) {
		return undefined
	}

	// nRF Connect terminal names - check common patterns
	const nordicPatterns = ["nrf terminal", "nrf connect", "ncs terminal", "ncs", "zephyr"]

	for (const terminal of terminals) {
		const name = terminal.name.toLowerCase()
		if (nordicPatterns.some((pattern) => name.includes(pattern))) {
			return terminal
		}
	}

	// Fallback: return the most recently used/active terminal
	// vscode.window.activeTerminal is the currently focused terminal
	if (vscode.window.activeTerminal) {
		return vscode.window.activeTerminal
	}

	// Last resort: return the last terminal in the list (most recently created)
	return terminals[terminals.length - 1]
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

	// If no nRF terminal found, try to create one
	if (!terminal) {
		const extension = vscode.extensions.getExtension("nordic-semiconductor.nrf-connect")

		if (extension) {
			await vscode.commands.executeCommand("nrf-connect.createNcsTerminal")
			// Wait for terminal to be created
			await new Promise((resolve) => setTimeout(resolve, 1500))
			terminal = findNordicTerminal()
		}
	}

	// Show/focus the terminal
	if (terminal) {
		terminal.show()
		return terminal.name
	}
	return undefined
}
