import { readTextFromClipboard, writeTextToClipboard } from "@utils/env"
import * as vscode from "vscode"

/**
 * Gets the contents of the active terminal
 * @returns The terminal contents as a string
 */
export async function getLatestTerminalOutput(): Promise<string> {
	// Store original clipboard content to restore later
	const originalClipboard = await readTextFromClipboard()

	try {
		// Select terminal content
		await vscode.commands.executeCommand("workbench.action.terminal.selectAll")
		await new Promise((resolve) => setTimeout(resolve, 50)) // Short delay

		// Copy selection to clipboard
		await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

		// Clear the selection
		await vscode.commands.executeCommand("workbench.action.terminal.clearSelection")

		// Retrieve terminal contents from clipboard with retries
		// Windows clipboard is async, so we must wait for it to populate
		let terminalContents = ""
		let retries = 5
		while (retries > 0) {
			await new Promise((resolve) => setTimeout(resolve, 100))
			terminalContents = (await readTextFromClipboard()).trim()

			// If we got new content that isn't the original clipboard, we succeeded
			if (terminalContents !== originalClipboard && terminalContents.length > 0) {
				break
			}
			retries--
		}

		// Check if we failed to get new content
		if (terminalContents === originalClipboard) {
			return ""
		}

		// Clean up command separation (strip out the last command line itself if it duplicated)
		const lines = terminalContents.split("\n")
		const lastLine = lines.pop()?.trim()
		if (lastLine) {
			let i = lines.length - 1
			while (i >= 0 && !lines[i].trim().startsWith(lastLine)) {
				i--
			}
			terminalContents = lines.slice(Math.max(i, 0)).join("\n")
		}

		return terminalContents
	} finally {
		// Restore original clipboard content
		await writeTextToClipboard(originalClipboard)
	}
}
