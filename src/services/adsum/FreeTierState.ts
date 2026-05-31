/** In-memory cache of remaining free-tier tokens, seeded from register-install response. */
let cachedRemaining: number | undefined

export function setCachedFreeTokensRemaining(n: number) {
	cachedRemaining = n
}

export function getCachedFreeTokensRemaining(): number | undefined {
	return cachedRemaining
}

/**
 * Set true by AdsumFreeHandler the moment the backend returns HTTP 402.
 * Read by the Task loop to render the quota card instead of retrying.
 * A module-level singleton is used deliberately: it is immune to the
 * `instanceof` / error-cause-chain failures that occur across the esbuild
 * bundle boundary (the same import resolves to the same module both sides).
 */
let quotaJustExhausted = false

export function markQuotaExhausted() {
	quotaJustExhausted = true
}

/** Returns the flag and resets it (consume-once semantics). */
export function consumeQuotaExhausted(): boolean {
	const v = quotaJustExhausted
	quotaJustExhausted = false
	return v
}
