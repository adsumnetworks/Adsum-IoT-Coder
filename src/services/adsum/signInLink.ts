import { completeSignInResult, type SignInOutcome } from "./AccountState"

/**
 * Copy-and-paste sign-in.
 *
 * The browser hands the sign-in back on a `vscode://…/auth/callback?code=…&state=…` link. With two editor
 * instances in different profiles, or when the OS gives `vscode://` to another editor, that link opens the
 * wrong window and the sign-in never arrives here. The done page shows the same link to copy; this takes it
 * and hands its code and state to the one exchange path the URI handler uses. There is no second path.
 */

export interface SignInLink {
	code: string
	state: string
}

/** Editors whose scheme a sign-in link may carry. Anything else is not our link. */
const SCHEMES = /^(vscode|vscode-insiders|cursor|windsurf|vscodium):\/\//i

/**
 * Accepts the full link (`vscode://…/auth/callback?code=…&state=…`, `vscode-insiders://…`) or only its query
 * (`code=…&state=…`, with or without a leading `?`). Returns null for anything else.
 */
export function parseSignInLink(input: string): SignInLink | null {
	const text = (input ?? "").trim().replace(/^["'<]+|[>"']+$/g, "")
	if (!text) {
		return null
	}
	let query: string
	if (SCHEMES.test(text)) {
		const q = text.indexOf("?")
		if (q === -1) {
			return null
		}
		const path = text.slice(0, q).replace(SCHEMES, "")
		if (!/\/auth\/callback\/?$/i.test(path)) {
			return null
		}
		query = text.slice(q + 1)
	} else if (/^\??code=/i.test(text) || /^\??state=/i.test(text)) {
		query = text.replace(/^\?/, "")
	} else {
		return null
	}
	const params = new URLSearchParams(query.split("#")[0])
	const code = params.get("code")?.trim() ?? ""
	const state = params.get("state")?.trim() ?? ""
	if (!/^[A-Za-z0-9_-]{16,}$/.test(code) || !/^[A-Za-z0-9_-]{8,}$/.test(state)) {
		return null
	}
	return { code, state }
}

export const PASTE_MESSAGES = {
	notALink: "That isn't a sign-in link. Copy the whole link from the browser page — it starts with vscode://.",
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
