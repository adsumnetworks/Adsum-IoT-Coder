/**
 * Control tokens a model sometimes leaves inside its own tool arguments.
 *
 * Smaller models occasionally close their function-call markup INSIDE an argument and then keep
 * writing — a field report caught a `read_file` whose path carried the close-token and the model's
 * own checklist appended to it, three times in one run, and the run failed as "bit not found"
 * because the path had a paragraph glued to the end of it.
 *
 * The assistant-message parser has stripped these for a long time, but only there: with native tool
 * calling the argument arrives as JSON and never passes through it. So the cleaning lives here,
 * beside neither path, and is applied where a native argument becomes a tool parameter.
 *
 * The token is written with FULL-WIDTH vertical bars (U+FF5C), which is what makes this safe: no
 * real path, command or file content contains that sequence by accident. Nothing else is touched —
 * angle brackets, ordinary pipes and newlines are all legitimate argument content.
 */

/** The opening or closing of any of the model's own markup tags. */
const CONTROL_TOKEN = /<\/?｜｜DSML｜｜/

/** True when a string carries one — used by tests and by the telemetry-free fast path. */
export function hasModelControlToken(value: string): boolean {
	return CONTROL_TOKEN.test(value)
}

/**
 * Everything the model wrote before it started closing its own markup.
 *
 * A cut, not a replace: what follows the token is the model talking to itself (a checklist, another
 * tool call), never more of this argument. Whitespace immediately before the cut goes with it,
 * because it is the newline the model typed before the token — but a string with no token is
 * returned byte for byte.
 */
export function stripModelControlTokens(value: string): string {
	const match = CONTROL_TOKEN.exec(value)
	if (!match) {
		return value
	}
	return value.slice(0, match.index).replace(/\s+$/, "")
}

/** The same rule over a parsed argument object: every string field, however deep it is not. */
export function cleanNativeToolInput(input: unknown): unknown {
	if (typeof input === "string") {
		return stripModelControlTokens(input)
	}
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return input
	}
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		out[key] = typeof value === "string" ? stripModelControlTokens(value) : value
	}
	return out
}
