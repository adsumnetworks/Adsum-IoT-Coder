import { HostProvider } from "@/hosts/host-provider"
import { readTaskHistoryFromState } from "../../core/storage/disk"
import { StateManager } from "../../core/storage/StateManager"
import { ShowMessageType } from "../../shared/proto/host/window"

// Fires at most once per session, only for users who installed but never completed
// the demo ("wow" moment). Dormant = has tasks but no demo completion.
// New installs (zero tasks) get nothing here — the announcement CTA handles them.

const DEMO_TASK_PREFIX = "Debug a real BLE NUS bug"
// At most one nudge every 3 days so re-opens don't spam the user.
const MIN_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000

export async function maybeShowReengagementNudge(): Promise<void> {
	try {
		const history = await readTaskHistoryFromState()
		if (!history || history.length === 0) {
			// New install — handled by the announcement CTA.
			return
		}

		const hasCompletedDemo = history.some((h) => h.task?.startsWith(DEMO_TASK_PREFIX))
		if (hasCompletedDemo) {
			// Already had the wow moment — no nudge needed.
			return
		}

		const stateManager = StateManager.get()
		const lastShown = stateManager.getGlobalStateKey("reengagementNudgeLastShown") ?? 0
		if (Date.now() - lastShown < MIN_INTERVAL_MS) {
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
