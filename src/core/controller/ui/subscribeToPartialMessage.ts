import { EmptyRequest } from "@shared/proto/cline/common"
import { ClineMessage } from "@shared/proto/cline/ui"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * [0.5 sessions first] Partial-message streams are kept PER CONTROLLER: a streaming reply belongs to the
 * session tab whose task produced it, never to the other tabs or the rail.
 */
const activePartialMessageSubscriptions = new WeakMap<Controller, Set<StreamingResponseHandler<ClineMessage>>>()

function streamsFor(controller: Controller): Set<StreamingResponseHandler<ClineMessage>> {
	let set = activePartialMessageSubscriptions.get(controller)
	if (!set) {
		set = new Set()
		activePartialMessageSubscriptions.set(controller, set)
	}
	return set
}

/**
 * Subscribe to partial message events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToPartialMessage(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ClineMessage>,
	requestId?: string,
): Promise<void> {
	const streams = streamsFor(controller)
	streams.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		streams.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "partial_message_subscription" }, responseStream)
	}
}

/**
 * Send a partial message event to the webview(s) of ONE controller.
 * @param partialMessage The ClineMessage to send
 * @param controller The controller whose task produced it
 */
export async function sendPartialMessageEvent(partialMessage: ClineMessage, controller: Controller): Promise<void> {
	const streams = activePartialMessageSubscriptions.get(controller)
	if (!streams || streams.size === 0) {
		return
	}
	const promises = Array.from(streams).map(async (responseStream) => {
		try {
			await responseStream(
				partialMessage,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending partial message event:", error)
			// Remove the subscription if there was an error
			streams.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
