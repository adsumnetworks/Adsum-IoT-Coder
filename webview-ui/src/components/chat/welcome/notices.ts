/**
 * One notice at a time.
 *
 * The entry surface has five one-time messages — a CRA finding, the dock coach mark, the registered
 * receipt, the upgrade card and the review nudge — and until now each was its own boolean with a
 * single guard between two of them. Three could therefore stack, and on the operator's own screen two
 * did. Five messages sharing one slot need a queue, not five independent flags.
 *
 * The order is "what changes the most about the next hour", highest first:
 *
 *   cra         a compliance finding on their own code — about their work, not about us
 *   registered  the answer to something they JUST DID. Time-bound: shown a session later it is
 *               noise, shown now it is confirmation. The first render of this queue had the dock
 *               tip above it, and the screenshot of a freshly registered developer showed a layout
 *               tip where their receipt should have been. Fixed on sight, 9 Sep 2026.
 *   dock        changes the shape of every session after it, so it is worth the slot early and
 *               worth nothing late — but it is not tied to a moment, so it waits one dismissal
 *   upgrade     a standing offer; it can wait a session
 *   review      asks the developer for a favour, so it goes last, always
 *
 * Pure and total: the caller passes what is eligible, this says which one gets the slot.
 */
export type NoticeId = "cra" | "dock" | "registered" | "upgrade" | "review"

/** Highest priority first. The array IS the policy — there is no second place that encodes it. */
export const NOTICE_ORDER: readonly NoticeId[] = ["cra", "registered", "dock", "upgrade", "review"] as const

/**
 * `pin` is the one exception to the order: the update toast's CTA promised "See what's new", so on the
 * paint it opens the upgrade card takes the slot ahead of everything else, if it is eligible at all.
 * A pin that is not eligible is ignored, never invented.
 */
export function oneNotice(eligible: Partial<Record<NoticeId, boolean>>, pin?: NoticeId): NoticeId | undefined {
	if (pin && eligible[pin] === true) {
		return pin
	}
	return NOTICE_ORDER.find((id) => eligible[id] === true)
}
