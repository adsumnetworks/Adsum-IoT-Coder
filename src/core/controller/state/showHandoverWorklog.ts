import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { getHandoverActions } from "@/services/handover/HandoverActions"
import type { Controller } from ".."

/** Open the full worklog of the handed-over session (the strip shows only the recent rows). */
export async function showHandoverWorklog(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await getHandoverActions()?.showWorklog()
	} catch (error) {
		console.error("[handover] failed to open the worklog:", error)
	}
	return Empty.create()
}
