import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { refresh } from "@/services/adsum/AccountState"
import type { Controller } from ".."

/**
 * Re-read the profile now. The panel calls this when the developer expects a grant to have landed —
 * a group added in the admin page has to arrive without an editor restart.
 */
export async function refreshAccount(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await refresh(true)
	await controller.postStateToWebview()
	return Empty.create({})
}
