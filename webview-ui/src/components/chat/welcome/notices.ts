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
 *   dock        changes the shape of every session after it, so it is worth the slot early and
 *               worth nothing late
 *   registered  the answer to something they just did
 *   upgrade     a standing offer; it can wait a session
 *   review      asks the developer for a favour, so it goes last, always
 *
 * Pure and total: the caller passes what is eligible, this says which one gets the slot.
 */
export type NoticeId = "cra" | "dock" | "registered" | "upgrade" | "review"

/** Highest priority first. The array IS the policy — there is no second place that encodes it. */
export const NOTICE_ORDER: readonly NoticeId[] = ["cra", "dock", "registered", "upgrade", "review"] as const

export function oneNotice(eligible: Partial<Record<NoticeId, boolean>>): NoticeId | undefined {
	return NOTICE_ORDER.find((id) => eligible[id] === true)
}
