import { describe, expect, it } from "vitest"
import { freeTierStripVisible, LOW_BALANCE_TOKENS } from "../FreeTierStrip"

/**
 * The strip does three jobs — disclose who pays, report the balance, offer the way out — and only
 * the first has to happen on every install. So it shows until dismissed, and returns when the
 * balance is low enough that the other two matter.
 */
describe("the free tier strip earns its row", () => {
	it("shows before it has been dismissed", () => {
		expect(freeTierStripVisible(6_600_000, false)).toBe(true)
	})

	it("stays away once dismissed, while there is nothing to act on", () => {
		expect(freeTierStripVisible(6_600_000, true)).toBe(false)
	})

	it("COMES BACK when the balance is low, whatever was dismissed", () => {
		// The point of the whole rule: a dismissal is about a disclosure, not about a warning.
		expect(freeTierStripVisible(LOW_BALANCE_TOKENS, true)).toBe(true)
		expect(freeTierStripVisible(1_000, true)).toBe(true)
		expect(freeTierStripVisible(0, true)).toBe(true)
	})

	it("the threshold is a floor, not a ceiling — one token above it is still quiet", () => {
		expect(freeTierStripVisible(LOW_BALANCE_TOKENS + 1, true)).toBe(false)
	})

	it("renders nothing at all when the developer is not on the free tier", () => {
		// undefined means BYOK: never show a credit number to someone paying their own provider.
		expect(freeTierStripVisible(undefined, false)).toBe(false)
		expect(freeTierStripVisible(undefined, true)).toBe(false)
	})

	it("the floor is set against the real default grant", () => {
		// Backend config.stage0Quota is 500,000. A floor of 100k is the last session or two — late
		// enough not to nag, early enough to act before being blocked.
		expect(LOW_BALANCE_TOKENS).toBe(100_000)
	})
})
