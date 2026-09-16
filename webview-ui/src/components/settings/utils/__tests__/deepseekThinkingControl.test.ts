import { deepSeekModels } from "@shared/api"
import { LIVE_MODEL_PROVIDERS, RETIRED_MODEL_IDS } from "@shared/liveModels"
import { describe, expect, it } from "vitest"
import { getThinkingControl } from "../thinkingControl"

/**
 * THE CONTROL HAS TO EXIST FOR THE MODEL PEOPLE ARE ACTUALLY ON.
 *
 * [OPERATOR 2026-09-16] "the current deepseek flash inference menu doesn't allow any configuration to
 * the model including enabling thinking and controlling the level". It did not, and the panel was not
 * at fault: `getThinkingControl` returns "none" unless the model's info declares `supportsReasoning`,
 * and `deepseek-flash` — the id DeepSeek has served since 10 September, which reaches the dropdown
 * from the live model list — had no entry in the shipped table at all. An absent entry falls back to
 * defaults, so the model showed a 128K context, no prompt caching, no prices and no thinking dial,
 * every one of them wrong: the vendor publishes 1M context, cache hit/miss billing, and thinking on
 * at effort "high" by default.
 *
 * So this asserts the capability for every model the vendor serves today rather than for a list
 * someone remembered to update — a model offered in the dropdown with no controls is the defect.
 */
describe("the DeepSeek thinking control", () => {
	const served = Object.keys(deepSeekModels).filter((id) => !RETIRED_MODEL_IDS.deepseek.includes(id))

	it("covers the ids the vendor serves today", () => {
		expect(served).toContain("deepseek-flash")
		expect(served).toContain("deepseek-v4-pro")
	})

	it.each(served)("is reachable for %s", (id) => {
		const info = deepSeekModels[id as keyof typeof deepSeekModels]
		expect(getThinkingControl("deepseek", id, info)).toBe("onoff")
	})

	it("is hidden for the retired models, whose API would reject the parameter", () => {
		for (const id of RETIRED_MODEL_IDS.deepseek.filter((r) => r in deepSeekModels && r !== "deepseek-v4-flash")) {
			const info = deepSeekModels[id as keyof typeof deepSeekModels]
			expect(getThinkingControl("deepseek", id, info)).toBe("none")
		}
	})

	it("is offered on a provider that publishes a live list, so a rename cannot hide the model", () => {
		expect(LIVE_MODEL_PROVIDERS).toContain("deepseek")
	})
})
