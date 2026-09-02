import { QueueUserMessageRequest, QueueUserMessageResponse } from "@shared/proto/cline/task"
import { Controller } from ".."

/**
 * A message the developer sent while the task was already working.
 *
 * Deliberately not routed to askResponse. Nothing is awaiting an answer at this moment, so text written to
 * the ask slot would sit there until the next ask() — a tool or command approval — returned instantly with
 * it as the answer, approving something the developer never saw. This queues instead, and the task delivers
 * it at the next turn boundary.
 *
 * A refusal is a normal outcome and never an exception: the caller keeps the text in the box and says why.
 */
export async function queueUserMessage(
	controller: Controller,
	request: QueueUserMessageRequest,
): Promise<QueueUserMessageResponse> {
	try {
		if (!controller.task) {
			return QueueUserMessageResponse.create({ accepted: false, reason: "no_task", queued: 0 })
		}

		const result = await controller.task.queueUserMessage(
			request.text,
			request.images?.length ? request.images : undefined,
			request.files?.length ? request.files : undefined,
			"composer",
		)

		return QueueUserMessageResponse.create({
			accepted: result.accepted,
			reason: result.reason ?? "",
			queued: result.queued,
			id: result.id ?? "",
		})
	} catch (error) {
		// Never throw to the webview: the developer's text is still in the box, and a rejected promise there
		// would be indistinguishable from a message that was silently swallowed.
		console.error("Error in queueUserMessage handler:", error)
		return QueueUserMessageResponse.create({ accepted: false, reason: "error", queued: 0 })
	}
}
