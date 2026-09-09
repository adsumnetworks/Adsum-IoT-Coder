import { announcementId, toastText } from "@shared/releaseNotes"

/**
 * The announcement id: the release RELEASE_NOTES announces, not the package version. A hotfix that is
 * acknowledged as silent keeps the id, so it does not re-toast everyone who already saw the release.
 * (Before 0.4.0 the id was the full package version, and every patch bump re-showed the card.)
 */
export function getLatestAnnouncementId(): string {
	return announcementId()
}

/**
 * The "what's new" one-liner: the generic update toast AND the recurring nudge's fallback, so those
 * surfaces never drift. Split by audience (`isNewInstall`): a returning user hears what changed for THEM;
 * a first-timer gets a Welcome that leads with the free tier, because telling a brand-new user to wire in
 * a key contradicts "no key, no account", and a "what's new" line is odd when nothing is old for them yet.
 *
 * The words live in RELEASE_NOTES; this only picks the audience.
 */
export function whatsNewToastMessage(version: string, isNewInstall = false): string {
	return isNewInstall ? toastText("welcome") : toastText("update", version)
}
