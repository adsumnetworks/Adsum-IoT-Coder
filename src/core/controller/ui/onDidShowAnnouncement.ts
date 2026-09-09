import type { EmptyRequest } from "@shared/proto/cline/common"
import { Boolean } from "@shared/proto/cline/common"
import { getInstallId } from "@/services/adsum/InstallIdentity"
import { telemetryService } from "@/services/telemetry"
import { getLatestAnnouncementId } from "@/utils/announcements"
import type { Controller } from "../index"

/**
 * Marks the current announcement as shown
 *
 * @param controller The controller instance
 * @param _request The empty request (not used)
 * @returns Boolean indicating announcement should no longer be shown
 */
export async function onDidShowAnnouncement(controller: Controller, _request: EmptyRequest): Promise<Boolean> {
	try {
		const latestAnnouncementId = getLatestAnnouncementId()

		// `free_tier.upgrade_prompt_shown` was defined for this card and never fired, which left
		// `free_tier.byok_added` counting conversions with nothing above them: you could see who converted,
		// never how many were told there was something to convert to.
		//
		// The webview calls this endpoint both when the card renders and when it is dismissed, so the two
		// cannot be told apart here. Firing only on the version transition — the stored id is still the
		// previous version at this point — makes it a clean once-per-release "was told", and a dismissal
		// later in the same version cannot double-count it.
		const alreadyShown = controller.stateManager.getGlobalStateKey("lastShownAnnouncementId") === latestAnnouncementId
		if (!alreadyShown) {
			telemetryService.captureFreeTierUpgradePromptShown(getInstallId(), latestAnnouncementId)
		}

		// Update the lastShownAnnouncementId to the current latestAnnouncementId
		controller.stateManager.setGlobalState("lastShownAnnouncementId", latestAnnouncementId)
		controller.stateManager.setGlobalState("announcementRequested", undefined)
		return Boolean.create({ value: false })
	} catch (error) {
		console.error("Failed to acknowledge announcement:", error)
		return Boolean.create({ value: false })
	}
}
