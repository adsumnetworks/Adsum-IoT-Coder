import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { deepSeekModels, PRICING_SCHEDULES } from "@shared/api"
import { pricingMultiplier } from "../cost"

/**
 * The DeepSeek price table, pinned to the vendor's published figures.
 *
 * DeepSeek publishes prices in CNY with two columns — a standard (peak) rate and a discount
 * (off-peak) rate that is exactly half of it. Our table stores the peak rate in USD and
 * `pricingMultiplier` applies the discount by the clock, so a correct table has to satisfy both
 * columns at once from a single conversion rate.
 *
 * This asserts that guarantee rather than the six numbers themselves: if DeepSeek changes a price,
 * or someone converts one line at a different rate, or the peak/off-peak windows move, the
 * relationship breaks here instead of on a bill.
 *
 * Source: api-docs.deepseek.com/zh-cn/quick_start/pricing, read 2026-09-06. Peak is Beijing
 * 09:00-12:00 and 14:00-18:00 Mon-Fri, i.e. 01:00-04:00 and 06:00-10:00 UTC.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/utils/__tests__/deepseekPricing.node-test.ts
 */

/** CNY per 1M tokens, as published: [peak, off-peak]. */
const PUBLISHED_CNY = {
	"deepseek-v4-flash": {
		cacheReadsPrice: [0.1, 0.05],
		cacheWritesPrice: [3.0, 1.5],
		outputPrice: [9.0, 4.5],
	},
	"deepseek-v4-pro": {
		cacheReadsPrice: [0.3, 0.15],
		cacheWritesPrice: [9.0, 4.5],
		outputPrice: [27.0, 13.5],
	},
} as const

type PricedField = keyof (typeof PUBLISHED_CNY)["deepseek-v4-pro"]
const FIELDS: PricedField[] = ["cacheReadsPrice", "cacheWritesPrice", "outputPrice"]

/** A moment inside a published peak window: Monday 02:00 UTC. */
const PEAK = new Date(Date.UTC(2026, 8, 7, 2, 0, 0))
/** A moment outside every peak window: Sunday 10:00 UTC. */
const OFF_PEAK = new Date(Date.UTC(2026, 8, 6, 10, 0, 0))

describe("DeepSeek pricing matches the published table", () => {
	test("every price is the published peak rate at one consistent CNY/USD rate", () => {
		// Derive the rate from a single line, then hold every other line to it. A per-line rate
		// would let one wrong figure pass by inventing its own exchange rate.
		const rate = PUBLISHED_CNY["deepseek-v4-pro"].outputPrice[0] / deepSeekModels["deepseek-v4-pro"].outputPrice!
		assert.ok(rate > 5 && rate < 9, `implied CNY/USD rate ${rate} is not plausible`)

		for (const [modelId, published] of Object.entries(PUBLISHED_CNY)) {
			const info = deepSeekModels[modelId as keyof typeof deepSeekModels]
			for (const field of FIELDS) {
				const expected = published[field][0] / rate
				const actual = info[field]
				assert.ok(actual !== undefined, `${modelId}.${field} is missing`)
				assert.ok(
					Math.abs(actual - expected) < 0.0015,
					`${modelId}.${field} is ${actual}, but ¥${published[field][0]} at ${rate.toFixed(4)} is ${expected.toFixed(4)}`,
				)
			}
		}
	})

	test("the clock discount reproduces the published off-peak column", () => {
		const rate = PUBLISHED_CNY["deepseek-v4-pro"].outputPrice[0] / deepSeekModels["deepseek-v4-pro"].outputPrice!

		for (const [modelId, published] of Object.entries(PUBLISHED_CNY)) {
			const info = deepSeekModels[modelId as keyof typeof deepSeekModels]
			const multiplier = pricingMultiplier(modelId, OFF_PEAK)
			for (const field of FIELDS) {
				const expected = published[field][1] / rate
				const actual = info[field]! * multiplier
				assert.ok(
					Math.abs(actual - expected) < 0.0015,
					`${modelId}.${field} off-peak is ${actual}, but ¥${published[field][1]} is ${expected.toFixed(4)}`,
				)
			}
		}
	})

	test("peak windows are charged at full rate and the rest of the week at half", () => {
		for (const modelId of Object.keys(PUBLISHED_CNY)) {
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
		for (const modelId of Object.keys(PUBLISHED_CNY)) {
			const info = deepSeekModels[modelId as keyof typeof deepSeekModels]
			assert.equal(info.inputPrice, 0, `${modelId}.inputPrice must be 0; input is billed via the cache lines`)
		}
	})
})
