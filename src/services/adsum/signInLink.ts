import { parseSignInLink } from "@shared/signInLinkParse"
import { completeSignInResult, type SignInOutcome } from "./AccountState"

/**
 * Copy-and-paste sign-in.
 *
 * The browser hands the sign-in back on a `vscode://…/auth/callback?code=…&state=…` link. With two editor
 * instances in different profiles, or when the OS gives `vscode://` to another editor, that link opens the
 * wrong window and the sign-in never arrives here. The done page shows the same link to copy; this takes it
 * and hands its code and state to the one exchange path the URI handler uses. There is no second path.
 */

export { parseSignInLink, type SignInLink } from "@shared/signInLinkParse"

export const PASTE_MESSAGES = {
	notALink: "That doesn't look like a sign-in link. Copy the whole link from the browser page — it starts with vscode://.",
	otherWindow: "This link belongs to a sign-in started in another window. Press Sign in here and use the new link.",
	expired: "This sign-in link has expired or was already used. Press Sign in here and use the new link.",
	failed: "Sign-in couldn't be completed. Check your connection, then press Sign in to try again.",
	ok: "You're signed in.",
} as const

export interface PasteResult {
	ok: boolean
	message: string
}

/** Parse a pasted link and complete the sign-in through the shared exchange path. Never throws. */
export async function pasteSignInLink(
	input: string,
	complete: (code: string, state: string) => Promise<SignInOutcome> = completeSignInResult,
): Promise<PasteResult> {
	const link = parseSignInLink(input)
	if (!link) {
		return { ok: false, message: PASTE_MESSAGES.notALink }
	}
	let outcome: SignInOutcome
	try {
		outcome = await complete(link.code, link.state)
	} catch {
		outcome = "failed"
	}
	switch (outcome) {
		case "ok":
			return { ok: true, message: PASTE_MESSAGES.ok }
		case "state_mismatch":
			return { ok: false, message: PASTE_MESSAGES.otherWindow }
		case "expired":
			return { ok: false, message: PASTE_MESSAGES.expired }
		default:
			return { ok: false, message: PASTE_MESSAGES.failed }
	}
}
