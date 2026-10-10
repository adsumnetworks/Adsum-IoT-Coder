/**
 * [0.5 mcp prompts] `/mcp:<server>:<prompt>` is a slash entry for a prompt an MCP server offers,
 * alongside the built-in commands and workflow files. Resolving one fetches the prompt's text
 * from the server and substitutes it for the token, so the rest of the message carries straight
 * through unchanged. A server that cannot answer, or does not expose the prompt, is a reason to
 * leave the token as plain text, never a reason to stall the message.
 */

// (^|\s) / mcp : server : prompt (?=\s|$) — server and prompt names are the same restricted
// character set the built-in slash commands use, so a colon inside either name can never be
// mistaken for the separator.
const MCP_PROMPT_TOKEN_REGEX = /(^|\s)\/mcp:([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.-]+)(?=\s|$)/

export interface McpPromptToken {
	/** Index of the "/" in the source text. */
	index: number
	/** The full "/mcp:server:prompt" token, as written. */
	token: string
	serverName: string
	promptName: string
}

/** Finds the first `/mcp:<server>:<prompt>` token in `text`, or null if there is none. */
export function parseMcpPromptToken(text: string): McpPromptToken | null {
	const match = MCP_PROMPT_TOKEN_REGEX.exec(text)
	if (!match) {
		return null
	}
	const [, leading, serverName, promptName] = match
	const index = match.index + leading.length
	return {
		index,
		token: `/mcp:${serverName}:${promptName}`,
		serverName,
		promptName,
	}
}

/** The subset of McpHub this module needs — kept narrow so tests can pass a plain stub. */
export interface McpPromptSource {
	getPrompt(serverName: string, promptName: string): Promise<string | undefined>
}

/**
 * Resolves the first `/mcp:<server>:<prompt>` token in `text` against `hub` and substitutes the
 * fetched prompt text for it. Leaves `text` unchanged when there is no token, the server has no
 * such prompt, or the lookup fails — resolution degrades, it never throws into the caller.
 */
export async function applyMcpPromptCommand(text: string, hub: McpPromptSource): Promise<string> {
	const parsed = parseMcpPromptToken(text)
	if (!parsed) {
		return text
	}

	let promptText: string | undefined
	try {
		promptText = await hub.getPrompt(parsed.serverName, parsed.promptName)
	} catch {
		promptText = undefined
	}

	if (!promptText) {
		return text
	}

	return text.slice(0, parsed.index) + promptText + text.slice(parsed.index + parsed.token.length)
}
