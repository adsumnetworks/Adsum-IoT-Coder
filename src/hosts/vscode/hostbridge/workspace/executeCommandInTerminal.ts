import { ExecuteCommandInTerminalRequest, ExecuteCommandInTerminalResponse } from "@shared/proto/host/workspace"
import * as vscode from "vscode"
import { TerminalRegistry } from "@/hosts/vscode/terminal/VscodeTerminalRegistry"

/**
 * Executes a command in a new terminal
 * @param request The request containing the command to execute
 * @returns Response indicating success
 */
export async function executeCommandInTerminal(
	request: ExecuteCommandInTerminalRequest,
): Promise<ExecuteCommandInTerminalResponse> {
	try {
		// The SAME name and icon TerminalRegistry uses. These two are the only places a terminal is
		// created, and they disagreed: a command run through this path opened a tab labelled "Cline"
		// with Cline's robot, beside tabs from the other path labelled "Adsum IoT Coder". The developer
		// sees one product; the tab strip should not say otherwise.
		//
		// The mark, never a wordmark: a terminal tab renders this at 16 px, where anything with
		// lettering in it is a smudge.
		const terminalOptions: vscode.TerminalOptions = {
			...TerminalRegistry.terminalIdentity(),
			env: {
				CLINE_ACTIVE: "true",
			},
		}

		// Create a new terminal
		const terminal = vscode.window.createTerminal(terminalOptions)

		// Show the terminal to the user
		terminal.show()

		// Send the command to the terminal
		terminal.sendText(request.command, true)

		return ExecuteCommandInTerminalResponse.create({
			success: true,
		})
	} catch (error) {
		console.error("Error executing command in terminal:", error)
		return ExecuteCommandInTerminalResponse.create({
			success: false,
		})
	}
}
