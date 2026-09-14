import { groupLine } from "@shared/adsumGroupWords"
import * as vscode from "vscode"
import { sendAccountAction } from "@/core/controller/adsum/subscribeToAccountAction"
import { type AccountProfile, getAccount, onAccountChanged } from "@/services/adsum/AccountState"
import { accountMenuItems } from "@/services/adsum/accountMenu"

/**
 * The account icon in the panel header, between history and settings. The header row is the editor's own
 * title bar, so the icon is a command whose `when` clause reads `adsum.signedIn`: the editor's `sign-in` codicon
 * when signed out, its `account` codicon when signed in (codicons, not a contributed font: a Remote SSH window loads
 * no extension icon font). It follows the host's account state — seeded from the stored session on activation, then
 * every sign-in, sign-out and change made in another window of the profile.
 */
export function registerAccountButton(context: vscode.ExtensionContext, revealPanel: () => Promise<void>): void {
	const sync = (profile: AccountProfile | null) => {
		void vscode.commands.executeCommand("setContext", "adsum.signedIn", !!profile)
	}
	sync(getAccount())
	context.subscriptions.push({ dispose: onAccountChanged(sync) })

	context.subscriptions.push(
		vscode.commands.registerCommand("adsum.account.signIn", async () => {
			await revealPanel()
			await sendAccountAction("signin")
		}),
		vscode.commands.registerCommand("adsum.account.menu", async () => {
			const profile = getAccount()
			if (!profile) {
				await revealPanel()
				await sendAccountAction("signin")
				return
			}
			const items = accountMenuItems(profile, groupLine)
			const pick = await vscode.window.showQuickPick(
				items.map((i) => ({
					label: i.label,
					description: i.description,
					action: i.action,
				})),
				{ title: "Adsum account", placeHolder: profile.email },
			)
			if (pick?.action) {
				await revealPanel()
				await sendAccountAction(pick.action)
			}
		}),
	)
}
