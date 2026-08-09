import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { effectiveMaxOutputTokens, MAX_OUTPUT_TOKENS, outputReservation } from "./output-reservation"

/**
 * Pins the glm-5-turbo failure of 2026-08-08: repeated compaction followed by
 * 400 "Prompt exceeds max length" (z.ai code 1261).
 *
 * The provider counts prompt + requested output against the window. glm-5-turbo declares 131,072
 * output tokens against a 200,000 window, so requesting all of it left ~69K for the conversation
 * while the budget was handing out 160,000 — an impossible target that no amount of compaction
 * could reach.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/context/context-management/output-reservation.test.ts
 */

// The real numbers from src/shared/api.ts.
const GLM_5_TURBO = { maxTokens: 131_072, contextWindow: 200_000 }
const GLM_4_7 = { maxTokens: 131_072, contextWindow: 204_800 }
const GLM_5_2 = { maxTokens: 131_072, contextWindow: 1_000_000 }
const CLAUDE_HAIKU = { maxTokens: 8_192, contextWindow: 200_000 }

/** Mirrors getContextWindowInfo's buffer table so the invariant can be asserted without an ApiHandler. */
function budgetFor(info: { maxTokens: number; contextWindow: number }): number {
	const cw = info.contextWindow
	const buffer = cw === 64_000 ? 27_000 : cw === 128_000 ? 30_000 : cw === 200_000 ? 40_000 : Math.max(40_000, cw * 0.1)
	const reserve = Math.max(buffer, outputReservation(info))
	return Math.max(Math.floor(cw * 0.2), cw - reserve)
}

describe("effectiveMaxOutputTokens", () => {
	test("caps a huge declared output limit", () => {
		assert.equal(effectiveMaxOutputTokens(GLM_5_TURBO), MAX_OUTPUT_TOKENS)
		assert.ok(effectiveMaxOutputTokens(GLM_5_TURBO) < GLM_5_TURBO.maxTokens)
	})

	test("never exceeds what the model declares", () => {
		assert.equal(effectiveMaxOutputTokens(CLAUDE_HAIKU), 8_192)
	})

	test("never takes more than a third of a small window", () => {
		const tiny = { maxTokens: 100_000, contextWindow: 30_000 }
		assert.equal(effectiveMaxOutputTokens(tiny), 10_000)
	})

	test("falls back sanely when the model declares nothing", () => {
		assert.equal(effectiveMaxOutputTokens({ maxTokens: 0, contextWindow: 128_000 }), 8_192)
		assert.equal(effectiveMaxOutputTokens({ maxTokens: undefined as never, contextWindow: 0 }), 8_192)
	})
})

describe("THE INVARIANT: prompt budget + requested output must fit the window", () => {
	for (const [name, info] of [
		["glm-5-turbo", GLM_5_TURBO],
		["glm-4.7", GLM_4_7],
		["glm-5.2", GLM_5_2],
		["claude-haiku", CLAUDE_HAIKU],
	] as const) {
		test(`${name}: budget + output <= context window`, () => {
			const budget = budgetFor(info)
			const output = effectiveMaxOutputTokens(info)
			assert.ok(
				budget + output <= info.contextWindow,
				`${name}: budget ${budget} + output ${output} = ${budget + output} exceeds window ${info.contextWindow}`,
			)
			assert.ok(budget > 0, "budget must leave room to work")
		})
	}

	test("regression: the OLD math would have failed glm-5-turbo", () => {
		// What shipped in 0.2.1-dev.3: a flat 40K buffer and the model's full declared output.
		const oldBudget = GLM_5_TURBO.contextWindow - 40_000 // 160_000
		const oldOutput = GLM_5_TURBO.maxTokens // 131_072
		assert.ok(oldBudget + oldOutput > GLM_5_TURBO.contextWindow, "precondition: the old math overflowed")
		// And the fix closes it.
		assert.ok(budgetFor(GLM_5_TURBO) + effectiveMaxOutputTokens(GLM_5_TURBO) <= GLM_5_TURBO.contextWindow)
	})
})
