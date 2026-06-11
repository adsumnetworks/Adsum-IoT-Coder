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
