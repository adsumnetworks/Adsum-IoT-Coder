import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Takes a queued message back before it has been delivered.
 *
 * Only ever a no-op if the message has already gone in — once delivered it is a real message in the
 * transcript and in the conversation, and unsending it would rewrite history the model has already read.
 */
export async function removeQueuedUserMessage(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		await controller.task?.removeQueuedUserMessage(request.value)
	} catch (error) {
		console.error("Error in removeQueuedUserMessage handler:", error)
	}
	return Empty.create()
}
