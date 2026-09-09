import "should"
import { describe, it } from "mocha"
import { isQuotaExhaustionEvidenced } from "../FreeTierState"

/**
 * The counter and the card must never contradict each other.
 *
 * Reported from the desk, 8 Sep 2026: the chat showed "Free tier quota exhausted" while the strip
 * directly above it read 6.6M tokens left. The strip was right. The card fired because the rule was
 * `flag || model.id === "free-default"` — on the free tier, ANY empty response was called an
 * exhausted quota. Only the real 402 path zeroes the counter, and no 402 had happened, which is
 * precisely why the two disagreed.
 */
describe("free tier — an exhausted quota has to be evidenced", () => {
	it("a real 402 is evidence, whatever the cached balance says", () => {
		// The flag is set in the fetch interceptor the moment the backend answers 402, before it
		// throws. It is the authoritative signal and it outranks a stale cache.
		isQuotaExhaustionEvidenced(true, 6_600_000).should.equal(true)
		isQuotaExhaustionEvidenced(true, undefined).should.equal(true)
		isQuotaExhaustionEvidenced(true, 0).should.equal(true)
	})

	it("a balance of zero is evidence on its own", () => {
		isQuotaExhaustionEvidenced(false, 0).should.equal(true)
		// Defensive: a negative balance is still spent.
		isQuotaExhaustionEvidenced(false, -1).should.equal(true)
	})

	it("AN EMPTY RESPONSE WITH TOKENS LEFT IS NOT AN EXHAUSTED QUOTA", () => {
		// This is the reported bug, as a case. A provider hiccup, a filtered completion, a stream
		// with no content blocks or an unparsable tool call all land on the same branch, and none of
		// them means the developer has run out of anything.
		isQuotaExhaustionEvidenced(false, 6_600_000).should.equal(false)
		isQuotaExhaustionEvidenced(false, 1).should.equal(false)
	})

	it("an unknown balance and no 402 is not evidence either", () => {
		// Before the first request of a session the cache can be undefined. Silence plus ignorance
		// must not be reported as an exhausted quota — the honest answer there is a provider error.
		isQuotaExhaustionEvidenced(false, undefined).should.equal(false)
	})
})
