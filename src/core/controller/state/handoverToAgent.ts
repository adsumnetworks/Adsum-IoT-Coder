import { Empty, StringRequest } from "@shared/proto/cline/common"
import { getHandoverActions } from "@/services/handover/HandoverActions"
import { telemetryService } from "@/services/telemetry"
import type { Controller } from ".."

/**
 * Hand the current session to the developer's own coding agent.
 *
 * Thin on purpose: the host action already owns the whole flow (git-baseline modal → brief with the
 * knowledge closure → project wiring → clipboard pickup → tracking), and it is the same code path the
 * command palette runs. Duplicating any of it here would give us two versions of one decision.
 */
export async function handoverToAgent(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		// The feature shipped in beta with no telemetry at all, so "hand a running task to your own coding
		// agent" was unmeasurable — including the quota card's escape hatch, which is the free tier's other
		// exit beside adding a key. Enums off the payload only: never the prompt or the brief.
		let source: string | undefined
		let intentId: string | undefined
		let platform: string | undefined
		try {
			const payload = request.value ? JSON.parse(request.value) : {}
			source = typeof payload.source === "string" ? payload.source : undefined
			intentId = typeof payload.intentId === "string" ? payload.intentId : undefined
			platform = typeof payload.platform === "string" ? payload.platform : undefined
		} catch {
			// A payload we cannot parse is still a handover worth counting.
		}
		telemetryService.captureHandoverStarted({ source, intentId, platform })

		await getHandoverActions()?.handOver(request.value || undefined)
	} catch (error) {
		console.error("[handover] failed to start a handover:", error)
	}
	return Empty.create()
}
