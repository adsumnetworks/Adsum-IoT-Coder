import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import { openExternal } from "@utils/env"
import { buildSignInUrl } from "@/services/adsum/AccountState"
import { getEditorWindowId } from "@/services/adsum/editorWindow"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import { getEditorIdentity } from "@/services/telemetry/editorIdentity"
import type { Controller } from ".."

/**
 * Open the browser at the sign-in page.
 *
 * Sign-in leaves the machine on purpose: the panel never sees a password, a provider token or an
 * OAuth redirect. What comes back is a one-time code on a `vscode://` URL, handled by
 * SharedUriHandler, and the bearer it exchanges for never reaches the webview at all.
 */
type Provider = "github" | "google" | "email"
const PROVIDERS: Provider[] = ["github", "google", "email"]

export async function startSignIn(controller: Controller, request: StringRequest): Promise<ProtoString> {
	const provider = (request.value ?? "").trim() as Provider
	if (!PROVIDERS.includes(provider)) {
		throw new Error(`Unknown sign-in provider: ${provider}`)
	}
	// The editor's own scheme travels with the request so the "Open …" button at the far end names the
	// right editor. VS Code, Cursor and Windsurf each have their own, and guessing wrong strands the
	// developer in a browser tab holding a link that does nothing.
	const scheme = getEditorIdentity()?.scheme || "vscode"
	// And which of that editor's windows, so the callback returns HERE rather than to whichever window
	// the OS happens to hand a `vscode://` URL to.
	const url = buildSignInUrl(provider, scheme, await getEditorWindowId())
	telemetryService.captureSignInStarted({ provider })
	try {
		await openExternal(url)
	} catch (e) {
		Logger.warn(`[account] could not open the browser: ${e instanceof Error ? e.message : String(e)}`)
		// Returning the URL rather than throwing: on a machine with no default browser, a link the
		// developer can copy is a better answer than an error toast.
		return ProtoString.create({ value: url })
	}
	await controller.postStateToWebview()
	return ProtoString.create({ value: "" })
}
