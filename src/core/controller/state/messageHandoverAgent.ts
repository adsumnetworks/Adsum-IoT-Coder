import { Empty, StringRequest } from "@shared/proto/cline/common"
import { getHandoverActions } from "@/services/handover/HandoverActions"
import type { Controller } from ".."

/** Queue a message for the coding agent working a handed-over session. MCP cannot push, so the host
 *  writes it to the session's queue and the agent receives it in the response to its next milestone —
 *  exactly what the composer's placeholder promises. */
export async function messageHandoverAgent(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		const text = (request.value ?? "").trim()
		if (text) {
			await getHandoverActions()?.messageAgent(text)
		}
	} catch (error) {
		console.error("[handover] failed to queue the message:", error)
	}
	return Empty.create()
}
