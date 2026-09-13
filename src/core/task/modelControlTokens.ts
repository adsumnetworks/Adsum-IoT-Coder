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
 * What makes this safe is that every sequence we cut on is a tokenizer control token — a thing the
 * model is supposed to emit around its output, never inside a value. Nothing else is touched:
 * angle brackets, ordinary pipes and newlines are all legitimate argument content.
 */

/**
 * The exact sequences we cut on, one per family, and why each is safe.
 *
 * Written as literal sequences and not as a loose pattern, because the safety argument is per
 * sequence: every one of these contains a character a real path, command or file body does not
 * carry — the FULL-WIDTH vertical bar U+FF5C in the first family, and the angle-pipe opener "<|"
 * followed by a known control word in the second. A pattern like /<\|.*\|>/ would also match
 * things a developer legitimately writes (a shell here-doc, a C macro, a markdown table cell), so
 * the list is exact and grows by evidence, not by guesswork.
 *
 *  1. <｜｜DSML｜｜ and </｜｜DSML｜｜  — the family in the field report. Full-width bars; a path
 *     containing them would have to be typed deliberately in a CJK input mode.
 *  2. <|im_start|> / <|im_end|>      — chat-turn markers; the pair a great many open models use.
 *  3. <|endoftext|>                  — the end-of-text marker inherited from the GPT-2 tokenizer.
 *  4. <|observation|>                — a tool-result marker some agentic open models emit.
 *  5. <|eot_id|>                     — end-of-turn id, the Llama-3 family's marker.
 *  6. <|end_of_turn|>                — the same idea, spelled out, in other open models.
 *
 * Each is a token the model's own tokenizer owns: they exist to be un-typeable in ordinary text,
 * which is exactly what makes cutting on them safe. Anything not on this list is left alone.
 */
const CONTROL_SEQUENCES = [
	"<｜｜DSML｜｜",
	"</｜｜DSML｜｜",
	"<|im_start|>",
	"<|im_end|>",
	"<|endoftext|>",
	"<|observation|>",
	"<|eot_id|>",
	"<|end_of_turn|>",
] as const

/** The earliest position at which any known control sequence starts, or -1. */
function firstControlIndex(value: string): number {
	let earliest = -1
	for (const token of CONTROL_SEQUENCES) {
		const at = value.indexOf(token)
		if (at !== -1 && (earliest === -1 || at < earliest)) {
			earliest = at
		}
	}
	return earliest
}

/** True when a string carries one — used by tests and by the telemetry-free fast path. */
export function hasModelControlToken(value: string): boolean {
	return firstControlIndex(value) !== -1
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
	const at = firstControlIndex(value)
	if (at === -1) {
		return value
	}
	return value.slice(0, at).replace(/\s+$/, "")
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
