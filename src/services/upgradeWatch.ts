import { ShowMessageType } from "@shared/proto/host/window"
import * as fs from "fs"
import * as path from "path"
import type * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Tell the developer when the build on disk is newer than the one running.
 *
 * VS Code swaps a running extension host when it installs an update itself. It does NOT when the VSIX is
 * force-installed from the CLI — `code-server --install-extension foo.vsix --force` — which is exactly how
 * this extension reaches a Remote-SSH bench. The new bytes land in the extensions directory and the host
 * keeps executing the ones it loaded at startup, with no sign anywhere that the two differ.
 *
 * On 2026-08-24 that cost two rounds of "this is fixed" / "it still does the old thing" on the same bug: the
 * host had been up since 02:56, the install landed at 10:47, and the session at 10:58 ran the 02:56 code. It
 * is a genuinely invisible failure — the file is right, the fix is right, and the thing running is neither.
 *
 * So: remember what `dist/extension.js` looked like at activation and notice if it changes underneath us.
 * Once, quietly, with the one action that resolves it.
 *
 * Not armed in development. Under `npm run watch` that file is rewritten on every keystroke, and a prompt
 * per rebuild would be noise the developer learns to dismiss — which is how a useful notice becomes
 * furniture nobody reads.
 */
export function watchForNewerInstalledBuild(context: vscode.ExtensionContext, isDev: boolean): void {
	if (isDev) {
		return
	}
	const bundle = path.join(context.extensionPath, "dist", "extension.js")
	const stamp = (): string | null => {
		try {
			const s = fs.statSync(bundle)
			return `${s.mtimeMs}:${s.size}`
		} catch {
			return null // packaged differently, or unreadable: say nothing rather than nag on a guess
		}
	}
	const loaded = stamp()
	if (!loaded) {
		return
	}

	let told = false
	const timer = setInterval(() => {
		const now = stamp()
		if (told || !now || now === loaded) {
			return
		}
		told = true
		clearInterval(timer)
		// FIRE-AND-FORGET: showMessage resolves only when the user answers, and nothing here waits on that.
		void HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			// No action button: the host bridge has no reload RPC, and an item that looks clickable and does
			// nothing is worse than plain instructions. The command name is the whole message.
			message:
				"A newer Adsum IoT Coder build is installed — this window is still running the previous one. " +
				"Run \u201cDeveloper: Reload Window\u201d to use it.",
		})
	}, 60_000)
	// Size + mtime, not a content hash: this runs on a timer for the life of the window, and re-hashing a
	// 20 MB bundle every minute to catch something that happens once a day is the wrong trade.
	context.subscriptions.push({ dispose: () => clearInterval(timer) })
}
