import { Empty, StringRequest } from "@shared/proto/cline/common"
import { getHandoverActions } from "@/services/handover/HandoverActions"
import type { Controller } from ".."

/** Bring a handed-over session back into Adsum — same path as the command-palette entry.
 *  `request.value` names a specific session (the history list opens one directly); empty = the newest. */
export async function continueHandoverHere(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		await getHandoverActions()?.continueHere(request.value || undefined)
	} catch (error) {
		console.error("[handover] failed to continue the session here:", error)
	}
	return Empty.create()
}
