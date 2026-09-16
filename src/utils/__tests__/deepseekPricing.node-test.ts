import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { deepSeekModels, PRICING_SCHEDULES } from "@shared/api"
import { pricingMultiplier } from "../cost"

/**
 * The DeepSeek price table, pinned to the vendor's published figures.
 *
 * Read 2026-09-16 from api-docs.deepseek.com/quick_start/pricing, which publishes USD directly with
 * two columns per line: a PEAK rate and an off-peak rate that is exactly half of it. Our table stores
 * the peak rate and `pricingMultiplier` applies the discount by the clock, so a correct table has to
 * satisfy both columns at once.
 *
 * This asserts that guarantee rather than trusting the numbers once: if DeepSeek changes a price, or
 * the peak windows move, or someone edits one line, it breaks here instead of on a bill.
 *
 * Peak is 01:00-04:00 and 06:00-10:00 UTC Mon-Fri (Beijing 09:00-12:00 and 14:00-18:00); every other
 * hour is off-peak. Earlier revisions of this file derived USD from the Chinese page's CNY column at a
 * single implied exchange rate; the English page states USD itself, so the conversion step — and the
 * chance of pinning a rate that drifts — is gone.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/utils/__tests__/deepseekPricing.node-test.ts
 */

/** USD per 1M tokens, as published: [peak, off-peak]. */
const PUBLISHED_USD = {
	"deepseek-flash": {
		cacheReadsPrice: [0.006, 0.003],
		cacheWritesPrice: [0.3, 0.15],
		outputPrice: [1.2, 0.6],
	},
	// The retired id, still accepted: the vendor serves it with V4.1-Flash and bills it at the Flash
	// price, so it must carry Flash's figures. It shipped with V4-Flash's own, which are now wrong.
	"deepseek-v4-flash": {
		cacheReadsPrice: [0.006, 0.003],
		cacheWritesPrice: [0.3, 0.15],
		outputPrice: [1.2, 0.6],
	},
	"deepseek-v4-pro": {
		cacheReadsPrice: [0.044, 0.022],
		cacheWritesPrice: [1.32, 0.66],
		outputPrice: [3.96, 1.98],
	},
} as const

type PricedField = keyof (typeof PUBLISHED_USD)["deepseek-v4-pro"]
const FIELDS: PricedField[] = ["cacheReadsPrice", "cacheWritesPrice", "outputPrice"]

/** A moment inside a published peak window: Monday 02:00 UTC. */
const PEAK = new Date(Date.UTC(2026, 8, 7, 2, 0, 0))
/** A moment outside every peak window: Sunday 10:00 UTC. */
const OFF_PEAK = new Date(Date.UTC(2026, 8, 6, 10, 0, 0))

describe("DeepSeek pricing matches the published table", () => {
	test("every price is the published peak rate", () => {
		for (const [modelId, published] of Object.entries(PUBLISHED_USD)) {
			const info = deepSeekModels[modelId as keyof typeof deepSeekModels]
			for (const field of FIELDS) {
				const actual = info[field]
				assert.ok(actual !== undefined, `${modelId}.${field} is missing`)
				assert.ok(
					Math.abs(actual - published[field][0]) < 1e-9,
					`${modelId}.${field} is ${actual}, but the page publishes $${published[field][0]} at peak`,
				)
			}
		}
	})

	test("the clock discount reproduces the published off-peak column", () => {
		for (const [modelId, published] of Object.entries(PUBLISHED_USD)) {
			const info = deepSeekModels[modelId as keyof typeof deepSeekModels]
			const multiplier = pricingMultiplier(modelId, OFF_PEAK)
			for (const field of FIELDS) {
				const actual = info[field]! * multiplier
				assert.ok(
					Math.abs(actual - published[field][1]) < 1e-9,
					`${modelId}.${field} off-peak is ${actual}, but the page publishes $${published[field][1]}`,
				)
			}
		}
	})

	test("peak windows are charged at full rate and the rest of the week at half", () => {
		for (const modelId of Object.keys(PUBLISHED_USD)) {
			assert.equal(pricingMultiplier(modelId, PEAK), 1, `${modelId} should be full rate Mon 02:00 UTC`)
			assert.equal(pricingMultiplier(modelId, OFF_PEAK), 0.5, `${modelId} should be half rate Sun 10:00 UTC`)
			// Weekday, but between the two published windows.
			assert.equal(
				pricingMultiplier(modelId, new Date(Date.UTC(2026, 8, 7, 5, 0, 0))),
				0.5,
				`${modelId} should be half rate Mon 05:00 UTC, between the two peak windows`,
			)
			assert.ok(PRICING_SCHEDULES[modelId], `${modelId} has no schedule, so it would silently bill at peak`)
		}
	})

	test("input is priced through the cache lines, never the flat input price", () => {
		// DeepSeek reports prompt_cache_hit_tokens + prompt_cache_miss_tokens = prompt_tokens, so the
		// handler routes all input through cacheReads/cacheWrites and passes 0 flat input tokens.
		// inputPrice must therefore be 0 — a non-zero value would double-charge every prompt.
		for (const modelId of Object.keys(PUBLISHED_USD)) {
			const info = deepSeekModels[modelId as keyof typeof deepSeekModels]
			assert.equal(info.inputPrice, 0, `${modelId}.inputPrice must be 0; input is billed via the cache lines`)
		}
	})
})
