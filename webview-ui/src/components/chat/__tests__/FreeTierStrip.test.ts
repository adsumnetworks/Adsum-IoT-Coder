import { describe, expect, it } from "vitest"
import { freeTierStripVisible, LOW_BALANCE_TOKENS } from "../FreeTierStrip"

/**
 * The strip does three jobs — disclose who pays, report the balance, offer the way out — and only
 * the first has to happen on every install. So it shows until dismissed, and returns when the
 * balance is low enough that the other two matter.
 */
describe("the free tier strip earns its row", () => {
	it("shows on a fresh install, before the first task — the disclosure lands before the first inference", () => {
		expect(freeTierStripVisible(6_600_000, false, false)).toBe(true)
	})

	it("RETIRES BY ITSELF once the install has any task history", () => {
		// The operator opened a fresh window and saw the strip the mockup had shown gone. The first rule
		// needed a click to get there; the event the developer performs anyway is the better boundary.
		expect(freeTierStripVisible(6_600_000, false, true)).toBe(false)
	})

	it("a manual dismiss still works before the first task", () => {
		expect(freeTierStripVisible(6_600_000, true, false)).toBe(false)
	})

	it("COMES BACK when the balance is low, whatever history or dismissal says", () => {
		// The point of the whole rule: history and dismissal are about a disclosure, not a warning.
		expect(freeTierStripVisible(LOW_BALANCE_TOKENS, true, true)).toBe(true)
		expect(freeTierStripVisible(1_000, true, true)).toBe(true)
		expect(freeTierStripVisible(0, false, true)).toBe(true)
	})

	it("the threshold is a floor, not a ceiling — one token above it is still quiet", () => {
		expect(freeTierStripVisible(LOW_BALANCE_TOKENS + 1, false, true)).toBe(false)
	})

	it("renders nothing at all when the developer is not on the free tier", () => {
		// undefined means BYOK: never show a credit number to someone paying their own provider.
		expect(freeTierStripVisible(undefined, false, false)).toBe(false)
		expect(freeTierStripVisible(undefined, true, true)).toBe(false)
	})

	it("the floor is set against the real default grant", () => {
		// Backend config.stage0Quota is 500,000. A floor of 100k is the last session or two — late
		// enough not to nag, early enough to act before being blocked.
		expect(LOW_BALANCE_TOKENS).toBe(100_000)
	})
})
