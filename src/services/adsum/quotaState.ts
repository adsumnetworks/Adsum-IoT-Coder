/**
 * [0.5 free tier quota states] One typed state for the webview to read instead of the handful of
 * loosely-related signals (the remaining count, whether a 402 was just seen, whether a 429 is in
 * effect) it would otherwise have to reassemble itself. `ok`, `low` and `spent` describe the
 * balance; `limited` describes a temporary block the backend itself imposed, which takes
 * priority over the balance because being blocked for the next N seconds matters more right now
 * than how many tokens are nominally left.
 */
import type { FreeTierQuotaState } from "@shared/freeTier"

export type { FreeTierQuotaKind, FreeTierQuotaState } from "@shared/freeTier"

/** The free tier's own 402 (quota exhausted) or 429 (rate limited), as last seen. */
export interface FreeTierLastError {
	status: 402 | 429
	/** Seconds until the backend expects the block to clear, from a Retry-After header. */
	retryAfterSeconds?: number
}

/** Below this many tokens remaining, the balance is "low" rather than merely "ok". */
export const LOW_QUOTA_THRESHOLD = 100_000

/**
 * Derives the one quota state the UI renders from the raw signals the host already tracks.
 * `lastError` always wins: a backend that just said "wait" or "you're out" is more current than
 * a remaining count that may be a request or two stale. `now` is a parameter, not `Date.now()`,
 * so a test can pin it.
 */
export function quotaState(
	remaining: number | undefined,
	lastError?: FreeTierLastError,
	now: Date = new Date(),
): FreeTierQuotaState {
	if (lastError) {
		const resetsAt =
			lastError.retryAfterSeconds !== undefined
				? new Date(now.getTime() + lastError.retryAfterSeconds * 1000).toISOString()
				: undefined
		return { kind: "limited", remaining, resetsAt }
	}
	if (remaining === 0) {
		return { kind: "spent", remaining }
	}
	if (remaining !== undefined && remaining < LOW_QUOTA_THRESHOLD) {
		return { kind: "low", remaining }
	}
	return { kind: "ok", remaining }
}
