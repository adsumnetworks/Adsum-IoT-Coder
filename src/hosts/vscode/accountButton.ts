import { groupLine } from "@shared/adsumGroupWords"
import * as vscode from "vscode"
import { sendAccountAction } from "@/core/controller/adsum/subscribeToAccountAction"
import { type AccountProfile, getAccount, onAccountChanged } from "@/services/adsum/AccountState"
import { accountMenuItems } from "@/services/adsum/accountMenu"

/**
 * The account icon in the panel header, between history and settings. The header row is the editor's own
 * title bar, so the icon is a command whose `when` clause reads `adsum.signedIn`: the plain account glyph when
 * signed out, the same glyph with an identity-colour dot when signed in. It follows the host's account state,
 * so it changes the moment a sign-in completes and on sign-out.
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
