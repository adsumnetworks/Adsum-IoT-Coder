/**
 * What the provider ACTUALLY accepted, learned from its refusals.
 *
 * WHY THIS EXISTS. A model's usable window is not reliably knowable ahead of time:
 *
 *  - the configured number can be wrong or stale for a given model id,
 *  - the provider counts `prompt + requested output` against the window, and
 *  - our own size figure is an ESTIMATE (roughly chars/4). That estimate is decent for prose and
 *    optimistic for what this extension actually handles — hex dumps, RTT captures, build logs and
 *    source — all of which tokenize far worse than prose. A prompt we score at 136K can genuinely be
 *    well past 160K to the provider's tokenizer.
 *
 * So rather than hardcode a guess, record the size at which a model actually refused and stay under it
 * from then on. One refusal teaches the ceiling; the recovery path already truncates and retries, so the
 * session survives the lesson instead of dying on it.
 *
 * Scope is the extension session (a module-level map). That is deliberate: it is long enough to stop a
 * task failing repeatedly, and short enough that a provider raising its limits is picked up on restart
 * rather than being remembered as a permanent handicap.
 */

/** Keep this much below the size that was refused — the next prompt must be meaningfully smaller. */
const BACKOFF = 0.85

/** Never shrink a window below this, or a task becomes unusable rather than merely constrained. */
const FLOOR = 16_000

const observed = new Map<string, number>()

/**
 * Record that `estimatedTokens` was REFUSED for this model. Stores a ceiling below that size.
 * Keeps the smallest ceiling seen, so repeated refusals ratchet down rather than oscillate.
 */
export function recordWindowRefusal(modelId: string, estimatedTokens: number): void {
	if (!modelId || !Number.isFinite(estimatedTokens) || estimatedTokens <= 0) {
		return
	}
	const ceiling = Math.max(FLOOR, Math.floor(estimatedTokens * BACKOFF))
	const previous = observed.get(modelId)
	if (previous === undefined || ceiling < previous) {
		observed.set(modelId, ceiling)
	}
}

/** The learned ceiling for a model, if it has ever refused a prompt. */
export function observedWindowCeiling(modelId: string): number | undefined {
	return modelId ? observed.get(modelId) : undefined
}

/** Test seam. */
export function clearObservedWindows(): void {
	observed.clear()
}
