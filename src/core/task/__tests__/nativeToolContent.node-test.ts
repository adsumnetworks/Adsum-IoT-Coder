import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ToolUse } from "@core/assistant-message"
import { reconcileNativeToolContent } from "../nativeToolContent"

/**
 * The text before a native tool call must be presented complete, not skipped.
 *
 * [BENCH 2026-09-04, U-30] Bench task 1788535882003: 14 of 16 text rows in `ui_messages.json`
 * were a single word ("I", "The", "Let"), every one still `partial: true`, while the same turns in
 * `api_conversation_history.json` carried 100–600 characters. The rebuild on tool arrival set the
 * streaming index to the first tool, past a text block it had just marked complete — so the one
 * `say("text", …, partial=false)` that persists a row never ran. The first test below is that
 * sequence; it fails against the old rule and passes against the clamp.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/task/__tests__/nativeToolContent.node-test.ts
 */

const tool = (name = "read_file"): ToolUse => ({ type: "tool_use", name, params: {}, partial: false }) as ToolUse

describe("when native tool calls arrive", () => {
	test("text still being presented (index 0) stays the current block, so it gets said complete", () => {
		// The bench sequence: reasoning → text "I'll start by…" (index still 0, first token shown) →
		// tool_calls chunk. The old rule moved the index to 1 here and the text was never revisited.
		const r = reconcileNativeToolContent({
			assistantTextOnly: "I'll start by setting up progress tracking and loading the product index.",
			toolBlocks: [tool()],
			currentIndex: 0,
		})
		assert.ok(r)
		assert.equal(r.index, 0)
		assert.equal(r.content[0].type, "text")
		assert.equal(r.content[0].partial, false, "the text is complete — presenting it now is what persists it")
		assert.equal(r.content[1].type, "tool_use")
	})

	test("text already presented (index 1) is not re-presented", () => {
		const r = reconcileNativeToolContent({ assistantTextOnly: "done", toolBlocks: [tool()], currentIndex: 1 })
		assert.equal(r?.index, 1)
	})

	test("an out-of-bounds index is pulled back to the first tool — the repair the jump existed for", () => {
		const r = reconcileNativeToolContent({ assistantTextOnly: "done", toolBlocks: [tool()], currentIndex: 7 })
		assert.equal(r?.index, 1)
	})

	test("no text before the tool: the tool is block 0 and the index is 0", () => {
		const r = reconcileNativeToolContent({ assistantTextOnly: "   ", toolBlocks: [tool()], currentIndex: 0 })
		assert.equal(r?.index, 0)
		assert.equal(r?.content[0].type, "tool_use")
	})

	test("no tool calls at all: nothing to reconcile", () => {
		assert.equal(reconcileNativeToolContent({ assistantTextOnly: "x", toolBlocks: [], currentIndex: 0 }), null)
	})
})
