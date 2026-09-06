/**
 * What the extension ACTUALLY sends to DeepSeek for reasoning.
 *
 * Reported twice now — "thinking = low but I see very long thinking sessions". The 4 Sept fix
 * reasoned about the settings panel; this pins the wire, which is the only thing DeepSeek sees.
 *
 * Run: npm run test:deepseek-reasoning
 */
import { strict as assert } from "node:assert"
import { describe, test } from "node:test"
import { DeepSeekHandler } from "./deepseek"

/** Capture the body the handler would POST, without a network. */
async function bodyFor(options: Record<string, unknown>): Promise<Record<string, any>> {
	const handler = new DeepSeekHandler({
		deepSeekApiKey: "sk-test",
		apiModelId: "deepseek-v4-pro",
		...options,
	} as never)
	let captured: Record<string, any> = {}
	// Replace the OpenAI client with one that records and then stops.
	;(handler as never as { client: unknown }).client = {
		chat: {
			completions: {
				create: async (b: Record<string, unknown>) => {
					captured = b
					throw new Error("STOP")
				},
			},
		},
	}
	try {
		const it = handler.createMessage("sys", [{ role: "user", content: "hi" }] as never)
		await it.next()
	} catch {
		/* the double throws once it has the body */
	}
	return captured
}

const show = (b: Record<string, any>) =>
	`thinking=${JSON.stringify(b.thinking) ?? "absent"} effort=${JSON.stringify(b.reasoning_effort) ?? "absent"}`

describe("DeepSeek reasoning — what reaches the wire", () => {
	test("choosing an effort with no explicit budget sends BOTH — the 4 Sept report", async () => {
		const b = await bodyFor({ reasoningEffort: "low" })
		assert.deepEqual(b.thinking, { type: "enabled" }, `got ${show(b)}`)
		assert.equal(b.reasoning_effort, "low", `got ${show(b)}`)
	})

	test("each level reaches the wire unchanged", async () => {
		for (const e of ["low", "high", "max"]) {
			const b = await bodyFor({ reasoningEffort: e })
			assert.equal(b.reasoning_effort, e, `effort ${e} → ${show(b)}`)
		}
	})

	test("thinking off sends disabled and NO effort — effort with thinking off is meaningless", async () => {
		const b = await bodyFor({ thinkingBudgetTokens: 0, reasoningEffort: "low" })
		assert.deepEqual(b.thinking, { type: "disabled" }, `got ${show(b)}`)
		assert.equal(b.reasoning_effort, undefined, `effort must not ride along: ${show(b)}`)
	})

	test("a budget with no effort turns thinking on and leaves the depth to DeepSeek", async () => {
		const b = await bodyFor({ thinkingBudgetTokens: 4096 })
		assert.deepEqual(b.thinking, { type: "enabled" }, `got ${show(b)}`)
		assert.equal(b.reasoning_effort, undefined)
	})

	test("choosing NOTHING sends nothing — DeepSeek's own default stands, and we do not pretend otherwise", async () => {
		const b = await bodyFor({})
		assert.equal(b.thinking, undefined, `got ${show(b)}`)
		assert.equal(b.reasoning_effort, undefined, `got ${show(b)}`)
	})

	test("the output budget is big enough that reasoning cannot starve the answer", async () => {
		// Reasoning tokens count against max_completion_tokens. Measured on the live API: a single
		// reasoning turn can spend 10,000+ tokens, so a small cap yields an EMPTY answer.
		const b = await bodyFor({ reasoningEffort: "high" })
		assert.ok(
			(b.max_completion_tokens ?? 0) >= 8000,
			`max_completion_tokens=${b.max_completion_tokens} — reasoning alone can exceed this and leave no answer`,
		)
	})
})
