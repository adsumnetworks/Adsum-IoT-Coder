import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { anthropicModels, deepSeekModels, deepSeekPricesCheckedAt, type ModelInfo, zaiCodingPlanModels } from "@shared/api"
import {
	hasUnknownPrices,
	PRICES_CHECKED_AT,
	pricesCheckedLabel,
	RETIRED_MODEL_IDS,
	reconcileModelList,
	UNKNOWN_MODEL_INFO,
	withoutRetired,
} from "@shared/liveModels"

/**
 * [OPERATOR 2026-09-14] "the extension must retrieve the latest models dynamically, and the prices it
 * shows were stale." On 10 September DeepSeek began serving `deepseek-v4-flash` as `deepseek-flash`, and the
 * shipped list went on offering the old name. These are the rules that decide what a developer is offered.
 */

const shipped: Record<string, ModelInfo> = {
	"model-a": { supportsPromptCache: true, inputPrice: 1, outputPrice: 2 },
	"model-b": { supportsPromptCache: false, inputPrice: 3, outputPrice: 4 },
}

describe("retired ids are never offered, with or without a live list", () => {
	test("no key yet, so no live list: the retired DeepSeek ids are still not offered", () => {
		const offered = reconcileModelList(deepSeekModels, null, { retired: RETIRED_MODEL_IDS.deepseek })
		for (const id of ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash"]) {
			assert.equal(id in offered, false, `${id} is retired`)
		}
		assert.ok("deepseek-v4-pro" in offered)
		assert.deepEqual(Object.keys(withoutRetired("deepseek", deepSeekModels)), Object.keys(offered))
	})

	test("a provider still listing a retired id does not bring it back", () => {
		const offered = reconcileModelList(deepSeekModels, [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }], {
			retired: RETIRED_MODEL_IDS.deepseek,
		})
		assert.deepEqual(Object.keys(offered), ["deepseek-v4-pro"])
	})

	test("the shipped table keeps them, so a saved configuration still resolves in the handler", () => {
		assert.ok("deepseek-v4-flash" in deepSeekModels && "deepseek-chat" in deepSeekModels)
	})
})

describe("reconcileModelList", () => {
	test("a fetched list replaces the shipped one", () => {
		const result = reconcileModelList(shipped, [{ id: "model-b" }, { id: "model-c" }])
		assert.deepEqual(Object.keys(result), ["model-b", "model-c"])
		// Known ids keep the shipped info; new ids get conservative info with no prices.
		assert.equal(result["model-b"], shipped["model-b"])
		assert.deepEqual(result["model-c"], UNKNOWN_MODEL_INFO)
		assert.equal(hasUnknownPrices(result["model-c"]), true)
		assert.equal(hasUnknownPrices(result["model-b"]), false)
	})

	test("a retired id disappears from the list offered — the DeepSeek rename, as served on 2026-09-14", () => {
		const result = reconcileModelList(deepSeekModels, [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }])
		assert.equal("deepseek-v4-flash" in result, false)
		assert.equal("deepseek-chat" in result, false)
		assert.equal("deepseek-reasoner" in result, false)
		assert.deepEqual(Object.keys(result), ["deepseek-v4-pro", "deepseek-flash"])
		assert.equal(result["deepseek-v4-pro"], deepSeekModels["deepseek-v4-pro"])
	})

	test("no list, an empty list or a list of junk leaves the shipped table as it is", () => {
		for (const fetched of [null, undefined, [], [{ id: "" }], [{} as never]]) {
			assert.deepEqual(reconcileModelList(zaiCodingPlanModels, fetched), { ...zaiCodingPlanModels })
		}
	})

	test("a dated snapshot keeps its alias offered and is not offered twice", () => {
		const result = reconcileModelList(anthropicModels, [
			{ id: "claude-haiku-4-5-20251001", created: 1_760_000_000 },
			{ id: "claude-sonnet-5", created: 1_780_000_000 },
		])
		assert.deepEqual(Object.keys(result), ["claude-sonnet-5", "claude-haiku-4-5"])
	})

	test("onlyNewerThanShipped keeps older generations out and lets a newer model in", () => {
		const result = reconcileModelList(
			anthropicModels,
			[
				{ id: "claude-sonnet-5", created: 1_780_000_000 },
				{ id: "claude-haiku-4-5-20251001", created: 1_760_000_000 },
				{ id: "claude-3-haiku-20240307", created: 1_709_000_000 },
				{ id: "claude-opus-5", created: 1_790_000_000 },
				{ id: "claude-undated" },
			],
			{ onlyNewerThanShipped: true },
		)
		assert.deepEqual(Object.keys(result), ["claude-sonnet-5", "claude-haiku-4-5", "claude-opus-5"])
	})

	test("acceptId filters what may be offered", () => {
		const result = reconcileModelList(shipped, [{ id: "model-a" }, { id: "embedding-x" }], {
			acceptId: (id) => id.startsWith("model-"),
		})
		assert.deepEqual(Object.keys(result), ["model-a"])
	})
})

describe("pricesCheckedLabel", () => {
	test("a dated price renders its date", () => {
		assert.equal(pricesCheckedLabel("2026-09-04"), "Prices checked 4 Sep 2026")
		assert.equal(pricesCheckedLabel("2026-07-11"), "Prices checked 11 Jul 2026")
	})

	test("a missing or malformed date renders nothing rather than a wrong date", () => {
		for (const bad of [undefined, "", "yesterday", "2026-13-01", "2026-09-00", "04/09/2026"]) {
			assert.equal(pricesCheckedLabel(bad), undefined)
		}
	})

	test("every direct provider in the dropdown with a shipped price table carries a real date", () => {
		assert.equal(PRICES_CHECKED_AT.deepseek, deepSeekPricesCheckedAt)
		for (const provider of ["deepseek", "anthropic", "zai-coding-plan"] as const) {
			assert.ok(pricesCheckedLabel(PRICES_CHECKED_AT[provider]), `${provider} has no usable price date`)
		}
	})
})
