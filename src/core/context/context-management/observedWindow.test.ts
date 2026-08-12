import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"
import { clearObservedWindows, observedWindowCeiling, recordWindowRefusal } from "./observed-window"

/**
 * Learning the real ceiling from a refusal is what stops the same overflow happening twice. The
 * motivating session (2026-08-12, glm-5-turbo) refused prompts we had estimated at 131,834 → 136,114
 * tokens, inside a configured 200,000 window, and repeated the same failure five times.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/context/context-management/observedWindow.test.ts
 */

describe("observed window ceiling", () => {
	beforeEach(() => clearObservedWindows())

	test("nothing is assumed before a refusal", () => {
		assert.equal(observedWindowCeiling("glm-5-turbo"), undefined)
	})

	test("a refusal sets a ceiling BELOW the refused size", () => {
		recordWindowRefusal("glm-5-turbo", 136_114)
		const c = observedWindowCeiling("glm-5-turbo") as number
		assert.ok(c < 136_114, `ceiling must be under the refused size (got ${c})`)
		assert.equal(c, Math.floor(136_114 * 0.85))
	})

	test("repeated refusals ratchet DOWN and never back up", () => {
		recordWindowRefusal("glm-5-turbo", 136_114)
		const first = observedWindowCeiling("glm-5-turbo") as number
		recordWindowRefusal("glm-5-turbo", 131_834) // an earlier, smaller refusal
		const second = observedWindowCeiling("glm-5-turbo") as number
		assert.ok(second < first, "smaller refusal must lower the ceiling")
		recordWindowRefusal("glm-5-turbo", 300_000) // a larger one must not raise it
		assert.equal(observedWindowCeiling("glm-5-turbo"), second, "ceiling must never rise")
	})

	test("models are tracked independently", () => {
		recordWindowRefusal("glm-5-turbo", 136_114)
		assert.equal(observedWindowCeiling("glm-5.2"), undefined, "one model's refusal must not constrain another")
	})

	test("never shrinks a window into uselessness", () => {
		recordWindowRefusal("tiny-model", 100)
		assert.ok((observedWindowCeiling("tiny-model") as number) >= 16_000, "a floor keeps the task usable")
	})

	test("junk input is ignored rather than poisoning the ceiling", () => {
		for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
			recordWindowRefusal("m", bad)
		}
		recordWindowRefusal("", 50_000)
		assert.equal(observedWindowCeiling("m"), undefined)
		assert.equal(observedWindowCeiling(""), undefined)
	})

	test("the motivating case: after one refusal the next budget is under the failure point", () => {
		// 136,114 refused → ceiling 115,696 → the next request aims well below where it broke.
		recordWindowRefusal("glm-5-turbo", 136_114)
		assert.ok((observedWindowCeiling("glm-5-turbo") as number) < 131_834, "must be under the FIRST observed failure too")
	})
})
