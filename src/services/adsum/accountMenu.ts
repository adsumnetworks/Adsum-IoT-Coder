import type { AccountProfile } from "./AccountState"

export interface AccountMenuItem {
	label: string
	description?: string
	/** What choosing it asks the panel to show; absent for a line that only informs. */
	action?: "settings" | "signout"
}

/**
 * What the header's account menu says for a signed-in account. Plain words: the groups come through the same
 * wording as the Account section, never as ids. Sign-out lives in the Account section (with its confirmation);
 * this menu takes the developer there rather than keeping a second sign-out of its own.
 */
export function accountMenuItems(profile: AccountProfile, words: (groups: readonly string[]) => string): AccountMenuItem[] {
	return [
		{ label: `Signed in as ${profile.email}` },
		{ label: "Opens", description: words(profile.groups) },
		{ label: "Account settings", action: "settings" },
		{ label: "Sign out", description: "in Account settings", action: "signout" },
	]
}
