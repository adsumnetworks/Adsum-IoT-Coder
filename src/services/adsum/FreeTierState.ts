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

/**
 * Persisted, once-ever guard for the `free_tier.first_run_started` funnel-entry
 * event. Without this the event fires on every createMessage call (every agent
 * step, every session restart), inflating funnel-entry counts massively.
 *
 * A globalState reference is captured at activation so the handler — which has
 * no direct globalState access — can still persist the flag across restarts.
 * An in-memory short-circuit avoids redundant awaits within a session.
 */
const FIRST_RUN_KEY = "adsum.firstRunStarted"

let _globalState: { get: (key: string) => unknown; update: (key: string, value: unknown) => Thenable<void> } | undefined
let _firstRunFiredThisSession = false

export function initFreeTierPersistence(globalState: {
	get: (key: string) => unknown
	update: (key: string, value: unknown) => Thenable<void>
}) {
	_globalState = globalState
	if (globalState.get(FIRST_RUN_KEY) === true) {
		_firstRunFiredThisSession = true
	}
}

/**
 * Returns true exactly once per install (the very first free-tier run ever).
 * Every subsequent call — this session or future sessions — returns false.
 */
export async function shouldFireFirstRunStarted(): Promise<boolean> {
	if (_firstRunFiredThisSession) {
		return false
	}
	_firstRunFiredThisSession = true
	if (_globalState && _globalState.get(FIRST_RUN_KEY) === true) {
		return false
	}
	await _globalState?.update(FIRST_RUN_KEY, true)
	return true
}
