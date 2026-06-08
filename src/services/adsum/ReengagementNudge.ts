import { basename } from "path"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { readTaskHistoryFromState } from "../../core/storage/disk"
import { StateManager } from "../../core/storage/StateManager"
import { ShowMessageType } from "../../shared/proto/host/window"
import { getFreeTierTokensForDisplay } from "./FreeTierState"
import { getInstallId } from "./InstallIdentity"

// Re-engages DORMANT users when they reopen VS Code. In-editor toasts can only reach users who
// come back to the editor — the truly churned (uninstalled / not opening VS Code) need email,
// which is a separate channel. Two reachable cohorts (history is non-empty here, so a user has
// always done *something* — either the demo or a real task):
//   • demo_no_work — ran the demo, never used it on real firmware → invite to try their own.
//   • did_work     — ran ≥1 real task, went idle → invite to pick up where they left off.

const DEMO_TASK_PREFIX = "Debug a real BLE NUS bug"
const DAY_MS = 24 * 60 * 60 * 1000

/** Idle for this long (since the last task) before we consider a user dormant. */
export const REENGAGEMENT_DORMANT_MS = 7 * DAY_MS
/** Never nudge more often than this, so reopens don't spam. */
export const REENGAGEMENT_MIN_INTERVAL_MS = 14 * DAY_MS
/** Decay (retention rule): stop after this many *consecutive ignores* (dismissed without acting).
 *  Clicking the CTA resets the streak — engaged users are never capped, the disengaged are left alone. */
export const REENGAGEMENT_MAX_IGNORES = 3

export type ReengagementCohort = "demo_no_work" | "did_work"

export interface ReengagementDecision {
	cohort: ReengagementCohort
	daysDormant: number
}

interface ReengagementThresholds {
	dormantMs?: number
	intervalMs?: number
	maxIgnores?: number
}

/**
 * Pure decision: should a dormant-user re-engagement nudge be shown, and for which cohort?
 * Extracted so the gating is unit-testable without VS Code / PostHog singletons. Thresholds are
 * injectable so tests (and a dev test-mode) can override them.
 *
 * @returns the cohort + how long they've been dormant, or null if no nudge should show.
 */
export function classifyReengagement(
	history: ReadonlyArray<{ task?: string; ts?: number }> | undefined,
	lastShownMs: number,
	ignoreCount: number,
	nowMs: number,
	thresholds?: ReengagementThresholds,
): ReengagementDecision | null {
	const dormantMs = thresholds?.dormantMs ?? REENGAGEMENT_DORMANT_MS
	const intervalMs = thresholds?.intervalMs ?? REENGAGEMENT_MIN_INTERVAL_MS
	const maxIgnores = thresholds?.maxIgnores ?? REENGAGEMENT_MAX_IGNORES

	// Brand-new install (no history): the welcome hero + install toast own first-run.
	if (!history || history.length === 0) {
		return null
	}
	// Decay: stop after repeated ignores. The caller resets ignoreCount to 0 on engagement (click),
	// so this only fires for users who keep dismissing — the disengaged are left alone.
	if (ignoreCount >= maxIgnores) {
		return null
	}
	// Rate limit so reopens within the window don't spam.
	if (nowMs - lastShownMs < intervalMs) {
		return null
	}
	// Dormancy is measured from the most recent task; active users are left alone.
	const lastTaskMs = history.reduce((max, h) => Math.max(max, h.ts ?? 0), 0)
	if (lastTaskMs === 0 || nowMs - lastTaskMs < dormantMs) {
		return null
	}

	const daysDormant = Math.floor((nowMs - lastTaskMs) / DAY_MS)
	// Any non-demo task counts as real work. With non-empty history, !hasWork ⇒ demo-only.
	const hasWork = history.some((h) => !!h.task && !h.task.startsWith(DEMO_TASK_PREFIX))
	return { cohort: hasWork ? "did_work" : "demo_no_work", daysDormant }
}

export interface ReengagementCopy {
	message: string
	cta: string
}

/** Context-aware copy for a cohort. Names the project when one is open; hints free balance. */
export function buildReengagementMessage(
	cohort: ReengagementCohort,
	ctx: { hasProject: boolean; projectName?: string; freeTokens?: number },
): ReengagementCopy {
	const quotaHint =
		ctx.freeTokens && ctx.freeTokens > 0 ? ` You still have ${ctx.freeTokens.toLocaleString()} free tokens.` : ""

	if (cohort === "demo_no_work") {
		return ctx.hasProject
			? {
					message: `You've seen Adsum debug a BLE bug — point it at ${ctx.projectName} and try it on your own firmware.${quotaHint}`,
					cta: "Debug my firmware",
				}
			: {
					message: `Ready to try Adsum on your own nRF firmware? Open your project and I'll debug it live.${quotaHint}`,
					cta: "Open my project",
				}
	}
	// did_work
	return ctx.hasProject
		? { message: `Pick up where you left off on ${ctx.projectName}?${quotaHint}`, cta: "Resume" }
		: {
				message: `Welcome back to Adsum IoT Coder — open your nRF project and let's keep going.${quotaHint}`,
				cta: "Open my project",
			}
}

/**
 * Shows the dormant re-engagement nudge if warranted. Never throws (must not block activation).
 * @param announcementShown true if the version/update toast already showed this launch — if so we
 *   skip, so a version-bump launch never double-toasts.
 */
export async function maybeShowReengagementNudge(announcementShown: boolean): Promise<void> {
	try {
		if (announcementShown) {
			return
		}

		const history = await readTaskHistoryFromState()
		const stateManager = StateManager.get()
		const lastShown = stateManager.getGlobalStateKey("reengagementNudgeLastShown") ?? 0
		const ignoreCount = stateManager.getGlobalStateKey("reengagementNudgeIgnores") ?? 0

		// Dev test-mode (set ADSUM_REENGAGE_TEST=1 in the launch config) collapses the time gates so
		// the nudge can be exercised under F5 without waiting 7 days. No effect in production.
		const testMode = process.env.ADSUM_REENGAGE_TEST === "1"

		// Silenced forever ("Don't show again") — the hard opt-out. Test-mode ignores it so it can be re-run.
		if (!testMode && stateManager.getGlobalStateKey("reengagementNudgeSilenced")) {
			return
		}

		const thresholds: ReengagementThresholds | undefined = testMode
			? { dormantMs: 0, intervalMs: 0, maxIgnores: Number.POSITIVE_INFINITY }
			: undefined

		const decision = classifyReengagement(history, lastShown, ignoreCount, Date.now(), thresholds)
		if (!decision) {
			return
		}

		// Context for the copy.
		let hasProject = false
		let projectName: string | undefined
		try {
			const roots = (await HostProvider.workspace.getWorkspacePaths({})).paths
			hasProject = roots.length > 0
			projectName = hasProject ? basename(roots[0]) : undefined
		} catch {
			// No workspace info — fall back to the no-project copy.
		}
		const freeTokens = getFreeTierTokensForDisplay()
		const { message, cta } = buildReengagementMessage(decision.cohort, { hasProject, projectName, freeTokens })

		// Stamp the rate-limit clock before showing; the ignore-streak is updated by the OUTCOME below
		// (reset on engage, incremented on dismiss) so engaged users are never capped.
		stateManager.setGlobalState("reengagementNudgeLastShown", Date.now())

		const installId = getInstallId()
		telemetryService.captureFreeTierReengagementShown(installId, decision.cohort, decision.daysDormant)

		// "Don't show again" is the one-click silence-forever escape hatch (retention red-line rule).
		const silence = "Don't show again"
		const { selectedOption } = await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message,
			options: { items: [cta, silence] },
		})

		if (selectedOption === cta) {
			// Engaged — reset the ignore streak so a returning, useful nudge isn't capped out.
			stateManager.setGlobalState("reengagementNudgeIgnores", 0)
			telemetryService.captureFreeTierReengagementClicked(installId, decision.cohort)
			await HostProvider.workspace.openClineSidebarPanel({})
		} else if (selectedOption === silence) {
			stateManager.setGlobalState("reengagementNudgeSilenced", true)
			telemetryService.captureFreeTierReengagementSilenced(installId, decision.cohort)
		} else {
			// Ignored (closed/auto-dismissed) — advance the decay counter; 3 in a row and we stop.
			stateManager.setGlobalState("reengagementNudgeIgnores", ignoreCount + 1)
			telemetryService.captureFreeTierReengagementDismissed(installId, decision.cohort)
		}
	} catch {
		// Non-critical — never block startup.
	}
}
