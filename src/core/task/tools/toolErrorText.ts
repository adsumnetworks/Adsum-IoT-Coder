/**
 * [0.5 loop detection] Every failing tool result — thrown or handed back by a handler — is
 * wrapped by `formatResponse.toolError` into a single `<error>...</error>` block. Reading that
 * marker back out is the one thing the loop detector needs to tell a failure from a success,
 * across both a thrown exception and a handler that returns its own error text without throwing.
 */
import type { ClineToolResponseContent } from "@shared/messages/content"

const ERROR_TAG_REGEX = /<error>\n([\s\S]*?)\n<\/error>/

/** Flattens a tool response down to plain text, the way the model would read it. */
function textOf(content: ClineToolResponseContent): string {
	if (typeof content === "string") {
		return content
	}
	return content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n")
}

/** Returns the error text inside a `toolError`-wrapped response, or undefined for a success. */
export function extractToolErrorText(content: ClineToolResponseContent): string | undefined {
	const text = textOf(content)
	const match = ERROR_TAG_REGEX.exec(text)
	return match ? match[1] : undefined
}

/** Appends a plain-text note to a tool response, string or block array alike. */
export function appendNote(content: ClineToolResponseContent, note: string): ClineToolResponseContent {
	if (typeof content === "string") {
		return `${content}\n\n${note}`
	}
	return [...content, { type: "text", text: note }]
}
