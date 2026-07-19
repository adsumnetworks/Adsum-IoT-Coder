import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { getHandoverActions } from "@/services/handover/HandoverActions"
import type { Controller } from ".."

/** Bring a handed-over session back into Adsum — same path as the command-palette entry. */
export async function continueHandoverHere(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await getHandoverActions()?.continueHere()
	} catch (error) {
		console.error("[handover] failed to continue the session here:", error)
	}
	return Empty.create()
}
