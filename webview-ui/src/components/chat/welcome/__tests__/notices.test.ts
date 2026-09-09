import { describe, expect, it } from "vitest"
import { NOTICE_ORDER, oneNotice } from "../notices"

/**
 * Reported from the operator's own screen: the dock coach mark, the registered receipt and the
 * upgrade card can all render at once, because each was an independent boolean with one guard
 * between two of them.
 */
describe("the entry surface shows one notice at a time", () => {
	it("never returns more than one — that is the whole point", () => {
		// Everything eligible at once: exactly one wins, and it is the highest priority.
		expect(oneNotice({ cra: true, dock: true, registered: true, upgrade: true, review: true })).toBe("cra")
	})

	it("falls through the order as each becomes ineligible", () => {
		expect(oneNotice({ dock: true, registered: true, upgrade: true, review: true })).toBe("registered")
		expect(oneNotice({ dock: true, upgrade: true, review: true })).toBe("dock")
		expect(oneNotice({ upgrade: true, review: true })).toBe("upgrade")
		expect(oneNotice({ review: true })).toBe("review")
	})

	it("nothing eligible shows nothing", () => {
		expect(oneNotice({})).toBeUndefined()
		expect(oneNotice({ cra: false, dock: false, registered: false, upgrade: false, review: false })).toBeUndefined()
	})

	it("the review nudge is last, because it asks the developer for a favour", () => {
		// Any other notice outranks it. If this ever inverts, we are interrupting someone's work to
		// ask them to rate us, which is the one thing a nudge must never do.
		for (const other of NOTICE_ORDER.filter((n) => n !== "review")) {
			expect(oneNotice({ [other]: true, review: true })).toBe(other)
		}
	})

	it("the order is the policy, and it is pinned here", () => {
		expect([...NOTICE_ORDER]).toEqual(["cra", "registered", "dock", "upgrade", "review"])
	})

	it("a freshly registered developer sees their receipt, not a layout tip", () => {
		// Seen in a render: a new install has the dock tip eligible, and with dock above registered
		// the person who just signed in got told to drag the panel sideways instead of being told
		// they were in. The receipt is bound to the moment; the tip can wait one dismissal.
		expect(oneNotice({ dock: true, registered: true })).toBe("registered")
	})
	it("a pin takes the slot ahead of the order when it is eligible", () => {
		expect(oneNotice({ cra: true, upgrade: true }, "upgrade")).toBe("upgrade")
	})

	it("a pin that is not eligible is ignored, never invented", () => {
		expect(oneNotice({ cra: true, review: true }, "upgrade")).toBe("cra")
		expect(oneNotice({}, "upgrade")).toBeUndefined()
	})
})
