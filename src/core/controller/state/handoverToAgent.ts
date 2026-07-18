import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { getHandoverActions } from "@/services/handover/HandoverActions"
import type { Controller } from ".."

/**
 * Hand the current session to the developer's own coding agent.
 *
 * Thin on purpose: the host action already owns the whole flow (git-baseline modal → brief with the
 * knowledge closure → project wiring → clipboard pickup → tracking), and it is the same code path the
 * command palette runs. Duplicating any of it here would give us two versions of one decision.
 */
export async function handoverToAgent(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await getHandoverActions()?.handOver()
	} catch (error) {
		console.error("[handover] failed to start a handover:", error)
	}
	return Empty.create()
}
