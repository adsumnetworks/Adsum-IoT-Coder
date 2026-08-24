import { readTextFromClipboard, writeTextToClipboard } from "@utils/env"
import * as vscode from "vscode"
import { TERMINAL_SNAPSHOT_TIMEOUT_MS } from "@/integrations/terminal/constants"

/**
 * Gets the contents of the active terminal.
 *
 * This is a clipboard round-trip: select the terminal, copy the selection, read the clipboard, put the
 * user's clipboard back. Over Remote-SSH the clipboard belongs to the LOCAL client while these commands are
 * issued from the remote extension host, and that round-trip can never come back — no error, no rejection,
 * a promise that never settles. A caller that awaits it then hangs forever.
 *
 * That happened: `execute_command` awaits this when the shell-integration stream delivered nothing, which
 * left runs sitting at "Pending" over commands whose output was plainly visible in the terminal beside
 * them. The bound lives HERE rather than at that one call site because `@terminal` mentions await it too,
 * and one unbounded await is all it takes.
 *
 * @returns The terminal contents, or "" if the round-trip does not answer in time.
 */
export async function getLatestTerminalOutput(): Promise<string> {
	return (await Promise.race([captureTerminalOutput(), timeoutAfter(TERMINAL_SNAPSHOT_TIMEOUT_MS)])) ?? ""
}

const timeoutAfter = (ms: number): Promise<undefined> => new Promise((resolve) => setTimeout(() => resolve(undefined), ms))

async function captureTerminalOutput(): Promise<string> {
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
