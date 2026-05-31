/** In-memory cache of remaining free-tier tokens, seeded from register-install response. */
let cachedRemaining: number | undefined

export function setCachedFreeTokensRemaining(n: number) {
	cachedRemaining = n
}

export function getCachedFreeTokensRemaining(): number | undefined {
	return cachedRemaining
}
