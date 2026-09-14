/**
 * Parse a sign-in link pasted by the developer. Shared by the host (which completes the sign-in) and the
 * panel (which submits on paste only when the value parses), so the two cannot disagree about what a link is.
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
