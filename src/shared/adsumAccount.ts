/**
 * The developer's account, as the webview sees it.
 *
 * Shared so the host and the panel cannot disagree about what "unlocked" means. Note what is NOT
 * here: the session bearer. The webview never holds a credential — it renders a lock or does not,
 * and every byte still comes through the registry, which asks the server. A tampered panel unlocks
 * a card's PICTURE and nothing behind it.
 */

export interface AdsumAccountState {
	email: string
	name: string
	emailVerified: boolean
	/** Entitlement groups held. `all` satisfies every group. */
	groups: string[]
	/** Families with a template-source request still open, as the server sees it. */
	openRequests: string[]
	/**
	 * The demo-pair tools the registry serves this account (`adsumDemoPairs.ts`), read from the manifest the
	 * host already holds. Absent until the host has read it, which the panel treats as "do not hide".
	 */
	servedDemoTools?: string[]
}

/** True when this account opens a bit in `group`. No group ⇒ free to everyone, signed in or not. */
export function accountHasGroup(account: AdsumAccountState | undefined | null, group: string | undefined): boolean {
	if (!group) {
		return true
	}
	const groups = account?.groups ?? []
	return groups.includes("all") || groups.includes(group)
}

/**
 * Dismissal id for the one-time "you're registered" card, in the same ledger as every other one-time
 * card. Shared so the panel that dismisses it and the controller that decides to show it cannot
 * disagree about the key.
 */
export const ADSUM_REGISTERED_BANNER = "adsum-registered"

/** The entitlement that opens the four cellular cards. One name, used by the card and by the bits. */
export const CELLULAR_GROUP = "cellular-advanced"
export const EDGE_AI_GROUP = "edge-ai-advanced"

/**
 * What a free account carries the moment it exists. Mirrors the server's `REGISTERED_TIER`
 * (`Adsum-Backend/src/services/groups.ts`), which resolves these at read time rather than writing
 * entitlement rows for them.
 *
 * Repeated here for ONE purpose: telling a developer the truth about a locked bit. "Register — it's
 * free" is right for these four and wrong for every other group, where an account exists already and
 * the grant has to be asked for. Sending someone to a sign-up page that changes nothing is worse than
 * saying plainly that access is by request.
 */
export const REGISTERED_TIER_GROUPS: readonly string[] = [CELLULAR_GROUP, EDGE_AI_GROUP, "lew840x-demo-hex", "blg20-demo-hex"]

/** True when simply registering opens this group — as opposed to it needing a request. */
export function tierOpens(group: string | null | undefined): boolean {
	return !!group && REGISTERED_TIER_GROUPS.includes(group)
}
