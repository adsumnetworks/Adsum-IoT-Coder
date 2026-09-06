/**
 * Which editor WINDOW this extension host belongs to, as a string of digits — or undefined when the
 * host cannot say.
 *
 * Why it exists: a `vscode://…` URL names an *application*. Nothing in it says which window, so the OS
 * hands it to the editor and the editor picks — reported from a real desk: sign-in started in one
 * window and the "You're signed in" hand-off landed in another. VS Code's answer is a `windowId` query
 * parameter: `env.asExternalUri()` stamps the current window's id onto a `vscode://` URI, and the main
 * process routes an incoming URL on `/\bwindowId=(\d+)/` to that window's connection. So the fix is to
 * carry our window id out with the sign-in and get it back on the callback.
 *
 * This module stays vscode-free — core code (`startSignIn`) reads it, and only the host knows how to
 * answer. The host registers a resolver at activation; the value is resolved on first use and cached,
 * so a sign-in click never races activation and activation never pays for a call it may not need.
 */
import { Logger } from "@/services/logging/Logger"

type Resolver = () => Promise<string | undefined>

let resolver: Resolver | undefined
let cached: string | undefined
let resolved = false

/** Host-only: register a resolver that returns the current window's id (digits), or undefined. */
export function setEditorWindowResolver(fn: Resolver | undefined): void {
	resolver = fn
	cached = undefined
	resolved = false
}

/**
 * The window id, or undefined. Never throws and never rejects: without it the callback still works —
 * it just may arrive in a different window, which `completeSignIn` already survives because the
 * pending nonce lives in shared global state. Degrading is right; failing the sign-in is not.
 */
export async function getEditorWindowId(): Promise<string | undefined> {
	if (resolved) return cached
	if (!resolver) return undefined
	try {
		const v = await resolver()
		cached = typeof v === "string" && /^\d{1,10}$/.test(v) ? v : undefined
	} catch (e) {
		Logger.warn(`[account] could not read this editor window's id: ${e instanceof Error ? e.message : String(e)}`)
		cached = undefined
	}
	resolved = true
	return cached
}

/** Tests only. */
export function _resetEditorWindowForTest(): void {
	resolver = undefined
	cached = undefined
	resolved = false
}
