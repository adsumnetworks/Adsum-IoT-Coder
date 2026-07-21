/**
 * The one-time "leave a review" nudge — the single source of truth for its threshold, its ledger id, and
 * the eligibility rule.
 *
 * Two halves of the feature live in different files: AttemptCompletionHandler COUNTS completions and fires
 * the eligibility signal, while Controller.postStateToWebview DECIDES whether to show the card. Before this
 * module the threshold was a constant in one and a hardcoded `>= 3` literal in the other — change one and the
 * show-gate silently drifts from the fire-gate. Both now import from here, so there is one number.
 *
 * Pure and dependency-free (no vscode, no StateManager) so it is trivially unit-testable and safe to import
 * from either the host or a test.
 */

/** Successful task completions before the nudge becomes eligible. Small on purpose: ask after real value. */
export const REVIEW_NUDGE_THRESHOLD = 3

/** Banner-dismissal ledger id. Dismissing (or acting on) the nudge records this so it retires for good. */
export const REVIEW_NUDGE_BANNER_ID = "review-nudge"

/**
 * Whether the nudge should show: enough wins, and not already retired via the banner-dismissal ledger.
 * `dismissedBanners` is the shape stored in global state (`{ bannerId, dismissedAt }[]`).
 */
export function reviewNudgeEligible(completions: number, dismissedBanners: ReadonlyArray<{ bannerId: string }>): boolean {
	return completions >= REVIEW_NUDGE_THRESHOLD && !dismissedBanners.some((b) => b.bannerId === REVIEW_NUDGE_BANNER_ID)
}
