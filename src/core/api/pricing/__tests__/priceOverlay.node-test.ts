import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { deepSeekModels } from "@shared/api"
import { pricingMultiplier } from "@utils/cost"
import { applyPriceOverlay, resetPriceLayers, setFetchedPrices, setManualPrices } from "../priceOverlay"

/**
 * Prices that can change without a release, and a clock discount no stored number can express.
 *
 * [OPERATOR 2026-09-04] "the model prices change over time, the price should be updated
 * dynamically" and "also allow manual pricing update". The evidence was already in the repo: the
 * bundled DeepSeek V4 figures had drifted 4.7x from the vendor's published rate while a test sat
 * green over them, because that test only asserted the table still said what it said when written.
 */

afterEach(() => resetPriceLayers())

const flash = () => deepSeekModels["deepseek-v4-flash"]

describe("the three layers, highest wins", () => {
	test("with no layers the bundled table is returned untouched — the offline contract", () => {
		assert.equal(applyPriceOverlay("deepseek-v4-flash", flash()), flash())
	})

	test("a fetched figure overrides the bundled one", () => {
		setFetchedPrices({ "deepseek-v4-flash": { outputPrice: 2 } })
		assert.equal(applyPriceOverlay("deepseek-v4-flash", flash()).outputPrice, 2)
	})

	test("the developer's own figure beats the fetched one — a negotiated rate is the last word", () => {
		setFetchedPrices({ "deepseek-v4-flash": { outputPrice: 2 } })
		setManualPrices({ "deepseek-v4-flash": { outputPrice: 0.9 } })
		assert.equal(applyPriceOverlay("deepseek-v4-flash", flash()).outputPrice, 0.9)
	})

	test("a layer overrides only the fields it names", () => {
		setFetchedPrices({ "deepseek-v4-flash": { outputPrice: 2 } })
		const out = applyPriceOverlay("deepseek-v4-flash", flash())
		assert.equal(out.cacheWritesPrice, flash().cacheWritesPrice, "an unmentioned price must not move")
		assert.equal(out.contextWindow, flash().contextWindow, "and non-price fields must not either")
	})

	test("a malformed price is ignored rather than becoming a real one", () => {
		// A zero here would read as "free", which is the most expensive thing to get wrong.
		setFetchedPrices({ "deepseek-v4-flash": { outputPrice: Number.NaN, cacheReadsPrice: -1 } as never })
		const out = applyPriceOverlay("deepseek-v4-flash", flash())
		assert.equal(out.outputPrice, flash().outputPrice)
		assert.equal(out.cacheReadsPrice, flash().cacheReadsPrice)
	})

	test("a model nobody overrode is unaffected by one that was", () => {
		setManualPrices({ "deepseek-v4-flash": { outputPrice: 0.9 } })
		assert.equal(applyPriceOverlay("deepseek-v4-pro", deepSeekModels["deepseek-v4-pro"]).outputPrice, 3.96)
	})
})

describe("DeepSeek's peak/off-peak window", () => {
	// Published: full rate 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday; half rate otherwise —
	// which is 79% of the week, so the discount is the common case, not the exception.
	const at = (iso: string) => new Date(iso)

	test("inside a weekday peak window: full rate", () => {
		assert.equal(pricingMultiplier("deepseek-v4-flash", at("2026-09-03T02:00:00Z")), 1, "Thursday 02:00")
		assert.equal(pricingMultiplier("deepseek-v4-flash", at("2026-09-03T09:59:00Z")), 1, "Thursday 09:59")
	})

	test("the boundaries are half open — 04:00 and 10:00 are already off-peak", () => {
		assert.equal(pricingMultiplier("deepseek-v4-flash", at("2026-09-03T04:00:00Z")), 0.5)
		assert.equal(pricingMultiplier("deepseek-v4-flash", at("2026-09-03T10:00:00Z")), 0.5)
	})

	test("the gap between the two windows is off-peak", () => {
		assert.equal(pricingMultiplier("deepseek-v4-flash", at("2026-09-03T05:00:00Z")), 0.5)
	})

	test("the same hour at the weekend is off-peak — the windows are weekdays only", () => {
		assert.equal(pricingMultiplier("deepseek-v4-flash", at("2026-09-05T02:00:00Z")), 0.5, "Saturday 02:00")
		assert.equal(pricingMultiplier("deepseek-v4-flash", at("2026-09-06T02:00:00Z")), 0.5, "Sunday 02:00")
	})

	test("a model with no schedule is never discounted", () => {
		assert.equal(pricingMultiplier("deepseek-chat", at("2026-09-03T05:00:00Z")), 1)
		assert.equal(pricingMultiplier(undefined, at("2026-09-03T05:00:00Z")), 1)
	})
})
