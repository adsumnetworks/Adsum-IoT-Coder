import { expect } from "chai"
import { describe, it } from "mocha"
import { REENGAGEMENT_MIN_INTERVAL_MS, shouldShowReengagementNudge } from "../ReengagementNudge"

const NOW = 1_000_000_000_000
const DEMO_TASK = { task: "Debug a real BLE NUS bug — Central→Peripheral works, but Peripheral→Central is silently dropped." }
const REAL_TASK = { task: "Add a BLE battery service to my_app" }

describe("shouldShowReengagementNudge", () => {
	it("brand-new install (no history) → no nudge (announcement CTA owns first-run)", () => {
		expect(shouldShowReengagementNudge([], 0, NOW)).to.equal(false)
		expect(shouldShowReengagementNudge(undefined, 0, NOW)).to.equal(false)
	})

	it("user who already completed the demo → never nag", () => {
		expect(shouldShowReengagementNudge([REAL_TASK, DEMO_TASK], 0, NOW)).to.equal(false)
	})

	it("dormant user (has tasks, no demo, never nudged) → show", () => {
		expect(shouldShowReengagementNudge([REAL_TASK], 0, NOW)).to.equal(true)
	})

	it("rate-limited: nudged inside the interval → no nudge", () => {
		const lastShown = NOW - (REENGAGEMENT_MIN_INTERVAL_MS - 1)
		expect(shouldShowReengagementNudge([REAL_TASK], lastShown, NOW)).to.equal(false)
	})

	it("interval elapsed → nudge again", () => {
		const lastShown = NOW - REENGAGEMENT_MIN_INTERVAL_MS
		expect(shouldShowReengagementNudge([REAL_TASK], lastShown, NOW)).to.equal(true)
	})

	it("demo-completion check wins over the rate-limit reset", () => {
		// Even if the interval has elapsed, a user who has seen the demo is never nudged.
		const lastShown = NOW - 10 * REENGAGEMENT_MIN_INTERVAL_MS
		expect(shouldShowReengagementNudge([DEMO_TASK], lastShown, NOW)).to.equal(false)
	})

	it("matches the demo task by prefix (display text varies after the prefix)", () => {
		const prefixOnly = [{ task: "Debug a real BLE NUS bug" }]
		expect(shouldShowReengagementNudge(prefixOnly, 0, NOW)).to.equal(false)
	})
})
