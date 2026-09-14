import * as vscode from "vscode"
import { type PasteResult, pasteSignInLink } from "@/services/adsum/signInLink"

/**
 * "Paste sign-in link": a VS Code input box, because a webview cannot prompt (confirm/alert/prompt are blocked
 * there). The answer is shown as a notification here AND returned, so the panel can say it where the developer
 * clicked. Cancelling the box is not an error and says nothing.
 */
export async function promptAndPasteSignInLink(): Promise<PasteResult | undefined> {
	const input = await vscode.window.showInputBox({
		title: "Paste sign-in link",
		prompt: "Paste the sign-in link from the browser page (it starts with vscode://).",
		placeHolder: "vscode://…/auth/callback?code=…&state=…",
		ignoreFocusOut: true,
	})
	if (input === undefined || !input.trim()) {
		return undefined
	}
	const result = await pasteSignInLink(input)
	if (result.ok) {
		void vscode.window.showInformationMessage(result.message)
	} else {
		void vscode.window.showErrorMessage(result.message)
	}
	return result
}
