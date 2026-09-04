import type { AssistantMessageContent, ToolUse } from "@core/assistant-message"

/**
 * Rebuild the assistant's content blocks when native tool calls arrive, WITHOUT skipping the
 * text that came before them.
 *
 * [BENCH 2026-09-04, U-30] Every text row in a session read as one word — "I", "The", "Let" —
 * while `api_conversation_history.json` held the full sentences (214 chars where the UI showed
 * "I"). On disk each of those rows was still `partial: true`. The text block was never finalised:
 * this reconciliation marked it `partial: false` and then set the streaming index straight to the
 * first tool block, so `presentAssistantMessage` never visited the text again. Its last
 * `say("text", …, partial=false)` — the one call that persists a row and pushes its final content
 * — never happened. What stayed on screen was whatever the last partial push managed, and with a
 * provider that emits its text and its tool call back-to-back after a long reasoning block, that
 * is the first token.
 *
 * I-09 had fixed the reasoning half of the same interleave and was proven display-only by the
 * same two-file diff. This is the text half, and it is only a display defect for the same reason:
 * the model's own context was always intact.
 *
 * The index jump existed for a reason — tools sat unexecuted when the index had advanced past
 * them or run out of bounds — so it is kept as a CLAMP rather than a reset: never past the first
 * tool, but never back before wherever presentation already is. From the text block it advances
 * itself, after saying the text complete.
 */
export function reconcileNativeToolContent(args: {
	assistantTextOnly: string
	toolBlocks: ToolUse[]
	currentIndex: number
}): { content: AssistantMessageContent[]; index: number } | null {
	if (!args.toolBlocks?.length) {
		return null
	}
	const textContent = args.assistantTextOnly.trim()
	const textBlocks: AssistantMessageContent[] = textContent ? [{ type: "text", content: textContent, partial: false }] : []
	const firstTool = textBlocks.length
	return {
		content: [...textBlocks, ...args.toolBlocks],
		// The bug was `index = firstTool`: right when presentation is still on the text (index 0)
		// and wrong only then. Clamping keeps the out-of-bounds repair and stops the skip.
		index: Math.min(args.currentIndex, firstTool),
	}
}
