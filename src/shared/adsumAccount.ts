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
}

/** True when this account opens a bit in `group`. No group ⇒ free to everyone, signed in or not. */
export function accountHasGroup(account: AdsumAccountState | undefined | null, group: string | undefined): boolean {
	if (!group) {
		return true
	}
	const groups = account?.groups ?? []
	return groups.includes("all") || groups.includes(group)
}

/** The entitlement that opens the four cellular cards. One name, used by the card and by the bits. */
export const CELLULAR_GROUP = "cellular-advanced"
export const EDGE_AI_GROUP = "edge-ai-advanced"
