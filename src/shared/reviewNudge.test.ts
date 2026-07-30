import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { REVIEW_NUDGE_BANNER_ID, REVIEW_NUDGE_THRESHOLD, reviewNudgeEligible } from "./reviewNudge"

describe("review nudge — eligibility (the show-gate must match the fire-gate)", () => {
	test("shows only once enough successful completions have accrued", () => {
		assert.equal(reviewNudgeEligible(0, []), false)
		assert.equal(reviewNudgeEligible(REVIEW_NUDGE_THRESHOLD - 1, []), false, "one short → not yet")
		assert.equal(reviewNudgeEligible(REVIEW_NUDGE_THRESHOLD, []), true, "exactly at threshold → show")
		assert.equal(reviewNudgeEligible(REVIEW_NUDGE_THRESHOLD + 5, []), true, "past threshold → still show until retired")
	})

	test("retires for good once dismissed via the banner ledger", () => {
		const dismissed = [{ bannerId: REVIEW_NUDGE_BANNER_ID, dismissedAt: 1 }]
		assert.equal(reviewNudgeEligible(REVIEW_NUDGE_THRESHOLD, dismissed), false, "our id present → never again")
		assert.equal(reviewNudgeEligible(999, dismissed), false, "no completion count resurrects it")
	})

	test("another banner's dismissal does not retire this one", () => {
		const other = [{ bannerId: "some-other-banner", dismissedAt: 1 }]
		assert.equal(reviewNudgeEligible(REVIEW_NUDGE_THRESHOLD, other), true)
	})

	test("the threshold is a small, positive integer (ask after real value, not on day one)", () => {
		assert.ok(Number.isInteger(REVIEW_NUDGE_THRESHOLD) && REVIEW_NUDGE_THRESHOLD >= 1 && REVIEW_NUDGE_THRESHOLD <= 10)
	})
})
