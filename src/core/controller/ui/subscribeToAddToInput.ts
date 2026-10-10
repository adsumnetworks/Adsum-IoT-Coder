import type { EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import { getRequestRegistry, type StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

/**
 * [0.5 sessions first] "Add to input" lands in ONE composer: the session tab that was asked for it. Streams
 * are kept per controller, and text sent before that tab's composer has subscribed (a card click opens the
 * tab and fills the box in the same breath) waits in a pending queue and is flushed on subscribe.
 */
const activeAddToInputSubscriptions = new WeakMap<Controller, Set<StreamingResponseHandler<ProtoString>>>()
const pendingAddToInput = new WeakMap<Controller, string[]>()

function streamsFor(controller: Controller): Set<StreamingResponseHandler<ProtoString>> {
	let set = activeAddToInputSubscriptions.get(controller)
	if (!set) {
		set = new Set()
		activeAddToInputSubscriptions.set(controller, set)
	}
	return set
}

/**
 * Subscribe to addToInput events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToAddToInput(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ProtoString>,
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
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "addToInput_subscription" }, responseStream)
	}

	// Flush what arrived before the composer was listening.
	const pending = pendingAddToInput.get(controller)
	if (pending?.length) {
		pendingAddToInput.delete(controller)
		for (const text of pending) {
			try {
				await responseStream({ value: text }, false)
			} catch (error) {
				console.error("Error flushing pending addToInput event:", error)
			}
		}
	}
}

/**
 * Send an addToInput event to the composer of ONE controller. Queued until that composer subscribes.
 * @param text The text to add to the input
 * @param controller The controller whose webview owns the composer
 */
export async function sendAddToInputEvent(text: string, controller: Controller): Promise<void> {
	const streams = activeAddToInputSubscriptions.get(controller)
	if (!streams || streams.size === 0) {
		const pending = pendingAddToInput.get(controller) ?? []
		pending.push(text)
		pendingAddToInput.set(controller, pending)
		return
	}
	const promises = Array.from(streams).map(async (responseStream) => {
		try {
			const event: ProtoString = {
				value: text,
			}
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending addToInput event:", error)
			// Remove the subscription if there was an error
			streams.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
