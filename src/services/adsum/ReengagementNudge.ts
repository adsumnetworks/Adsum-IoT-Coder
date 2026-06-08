import { HostProvider } from "@/hosts/host-provider"
import { readTaskHistoryFromState } from "../../core/storage/disk"
import { StateManager } from "../../core/storage/StateManager"
import { ShowMessageType } from "../../shared/proto/host/window"

// Fires at most once per interval, only for users who installed and ran at least one
// task but never completed the demo ("wow" moment). Dormant = has tasks, no demo.
// New installs (zero tasks) get nothing here — the announcement CTA handles them.

const DEMO_TASK_PREFIX = "Debug a real BLE NUS bug"
// At most one nudge every 3 days so re-opens don't spam the user.
export const REENGAGEMENT_MIN_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Pure decision: should the dormant-user re-engagement nudge be shown?
 * Extracted so the gating logic is unit-testable without VS Code / PostHog singletons.
 *
 * @param history     task history (undefined/empty ⇒ brand-new install)
 * @param lastShownMs unix-ms of the last nudge shown (0 ⇒ never)
 * @param nowMs       current unix-ms
 */
export function shouldShowReengagementNudge(
	history: ReadonlyArray<{ task?: string }> | undefined,
	lastShownMs: number,
	nowMs: number,
): boolean {
	// Brand-new install: the welcome demo hero + announcement CTA already cover them.
	if (!history || history.length === 0) {
		return false
	}
	// Already had the wow moment — never nag.
	if (history.some((h) => h.task?.startsWith(DEMO_TASK_PREFIX))) {
		return false
	}
	// Rate limit so re-opens within the window don't spam.
	return nowMs - lastShownMs >= REENGAGEMENT_MIN_INTERVAL_MS
}

export async function maybeShowReengagementNudge(): Promise<void> {
	try {
		const history = await readTaskHistoryFromState()
		const stateManager = StateManager.get()
		const lastShown = stateManager.getGlobalStateKey("reengagementNudgeLastShown") ?? 0

		if (!shouldShowReengagementNudge(history, lastShown, Date.now())) {
			return
		}

		stateManager.setGlobalState("reengagementNudgeLastShown", Date.now())

		const cta = "See it now (30s)"
		const { selectedOption } = await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Adsum can debug a real BLE bug live — want to see it?",
			options: { items: [cta] },
		})

		if (selectedOption === cta) {
			await HostProvider.workspace.openClineSidebarPanel({})
		}
	} catch {
		// Non-critical — never block startup.
	}
}
