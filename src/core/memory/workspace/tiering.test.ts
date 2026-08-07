import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import { shouldInjectMapFor } from "./mapGate"
import { TAIL_BEGIN, TAIL_END } from "./render"
import { stripTailBlock, withProjectStateTail } from "./tailBlock"

/**
 * The Tier A / Tier B invariants. These are the assertions the whole memory design rests on:
 * volatile state must never touch the cached system prompt, and exactly one current copy of the
 * state block must reach the model.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/memory/workspace/tiering.test.ts
 */

function tmpWorkspace(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-tier-"))
	fs.mkdirSync(path.join(root, ".adsum", "local"), { recursive: true })
	fs.writeFileSync(
		path.join(root, ".adsum", "status.json"),
		JSON.stringify({
			schema: 1,
			goal: { text: "Ship the BWG840 gateway.", setAt: "2026-07-11T08:02:00Z", setBy: "human" },
			defects: [
				{
					id: "d1",
					title: "UART frames dropped after WiFi reconnect",
					state: "open",
					evidence: ["logs/rtt/cap_1012.log:2211-2247"],
					nextStep: "instrument ring buffer high-water mark",
					updatedAt: "2026-08-06T12:00:00Z",
				},
			],
		}),
	)
	fs.writeFileSync(
		path.join(root, ".adsum", "local", "session.json"),
		JSON.stringify({ schema: 1, focus: "reproducing the drop", loop: [] }),
	)
	return root
}

describe("Tier B — state rides on the last user message", () => {
	test("appends the block to a string-content user message", () => {
		const root = tmpWorkspace()
		try {
			const out = withProjectStateTail([{ role: "user", content: "please fix the dropout" }] as never, root)
			const text = (out[0] as { content: string }).content
			assert.match(text, /please fix the dropout/, "original text preserved")
			assert.ok(text.includes(TAIL_BEGIN) && text.includes(TAIL_END), "block delimited")
			assert.match(text, /BWG840/, "goal recited")
			assert.match(text, /cap_1012\.log:2211-2247/, "evidence path, not the log body")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("attaches to the last TEXT block and never rewrites tool_result blocks", () => {
		const root = tmpWorkspace()
		try {
			const history = [
				{ role: "assistant", content: "ok" },
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "t1", content: "build output" },
						{ type: "text", text: "here is the log" },
					],
				},
			]
			const out = withProjectStateTail(history as never, root)
			const blocks = (out[1] as { content: Array<{ type: string; text?: string; content?: string }> }).content
			assert.equal(blocks[0].type, "tool_result")
			assert.equal(blocks[0].content, "build output", "tool_result untouched — protocol must not be corrupted")
			assert.match(blocks[1].text as string, /here is the log/)
			assert.ok((blocks[1].text as string).includes(TAIL_BEGIN))
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("only ever ONE block: re-applying replaces, never accumulates", () => {
		const root = tmpWorkspace()
		try {
			let h = withProjectStateTail([{ role: "user", content: "go" }] as never, root)
			for (let i = 0; i < 5; i++) {
				h = withProjectStateTail(h, root)
			}
			const text = (h[0] as { content: string }).content
			const occurrences = text.split(TAIL_BEGIN).length - 1
			assert.equal(occurrences, 1, `exactly one block after 6 applications (got ${occurrences})`)
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("no memory on disk ⇒ history returned untouched (zero cost)", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-empty-"))
		try {
			const history = [{ role: "user", content: "hello" }]
			assert.equal(withProjectStateTail(history as never, root), history, "same reference — no work done")
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("fail-open: undefined cwd, empty history, and a malformed store all pass through", () => {
		assert.doesNotThrow(() => withProjectStateTail([{ role: "user", content: "x" }] as never, undefined))
		assert.doesNotThrow(() => withProjectStateTail([] as never, "/nonexistent/path"))
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-bad-"))
		try {
			fs.mkdirSync(path.join(root, ".adsum"), { recursive: true })
			fs.writeFileSync(path.join(root, ".adsum", "status.json"), "{corrupt")
			assert.doesNotThrow(() => withProjectStateTail([{ role: "user", content: "x" }] as never, root))
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("stripTailBlock removes a block even when the end marker is missing", () => {
		const mangled = `real content\n\n${TAIL_BEGIN}\nhalf a block`
		assert.equal(stripTailBlock(mangled), "real content")
	})
})

describe("Map gate — decided once per task", () => {
	test("first task in a workspace always gets the map (cold start costs most)", () => {
		assert.equal(shouldInjectMapFor({ firstTaskInWorkspace: true, appCount: 1, mapEntryCount: 3 }), true)
	})
	test("a two-chip workspace always gets it (the gateway case)", () => {
		assert.equal(shouldInjectMapFor({ firstTaskInWorkspace: false, appCount: 2, mapEntryCount: 5, previousTurns: 3 }), true)
	})
	test("a long or exploration-heavy previous task turns it on", () => {
		assert.equal(shouldInjectMapFor({ firstTaskInWorkspace: false, appCount: 1, mapEntryCount: 5, previousTurns: 45 }), true)
		assert.equal(
			shouldInjectMapFor({ firstTaskInWorkspace: false, appCount: 1, mapEntryCount: 5, previousExplorationCalls: 20 }),
			true,
		)
	})
	test("a small, quiet single-app workspace does NOT pay for the map", () => {
		assert.equal(
			shouldInjectMapFor({
				firstTaskInWorkspace: false,
				appCount: 1,
				mapEntryCount: 6,
				previousTurns: 4,
				previousExplorationCalls: 2,
			}),
			false,
		)
	})
})
