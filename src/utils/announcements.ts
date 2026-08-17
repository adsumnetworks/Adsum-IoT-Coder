import { ExtensionRegistryInfo } from "@/registry"

/**
 * Gets the latest announcement ID based on the extension version.
 * Uses the FULL version (major.minor.patch, e.g. "0.1.5") so every release — including patch bumps
 * like 0.1.3 → 0.1.5 — counts as a new announcement and the "what's new" card/toast re-shows to
 * existing users. (Previously major.minor only, which treated all 0.1.x releases as one announcement,
 * so a 0.1.3 → 0.1.5 bump never re-appeared for users who'd already seen 0.1.x.)
 *
 * @returns The announcement ID string (full version) or empty string if unavailable
 */
export function getLatestAnnouncementId(): string {
	return ExtensionRegistryInfo.version
}

/**
 * The "what's new" one-liner. Single source of truth for the generic (non-CRA) update toast AND the recurring
 * nudge's fallback — so those surfaces never drift. A feature announcement, honest regardless of the open project.
 *
 * Split by audience (`isNewInstall`): a returning user hears what changed for THEM — 0.2.1 is project memory,
 * log-search efficiency and sessions that survive their own length; a first-timer instead gets a Welcome that
 * leads with the free tier, because telling a brand-new user to wire in a key contradicts "no key, no account"
 * — and a "what's new in v…" line is odd when nothing is old for them yet.
 */
export function whatsNewToastMessage(version: string, isNewInstall = false): string {
	return isNewInstall
		? `✦ Welcome to Adsum IoT Coder — the free tier is on, no key needed · curated firmware expertise, credited to the engineers who wrote it.`
		: `✦ What's new in Adsum IoT Coder v${version} — project memory across chats · token-efficient log search · longer sessions that hold up.`
}
