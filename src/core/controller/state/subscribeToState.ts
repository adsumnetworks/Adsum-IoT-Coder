import { EmptyRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * [0.5 sessions first] State streams are kept PER CONTROLLER. With one webview there was one set and one
 * controller; with the rail plus N session tabs, a controller's state (its task's messages, its ask) must
 * reach its own webview and no other, or every tab would repaint with the last tab's transcript.
 */
const activeStateSubscriptions = new WeakMap<Controller, Set<StreamingResponseHandler<State>>>()

function streamsFor(controller: Controller): Set<StreamingResponseHandler<State>> {
	let set = activeStateSubscriptions.get(controller)
	if (!set) {
		set = new Set()
		activeStateSubscriptions.set(controller, set)
	}
	return set
}

/**
 * Subscribe to state updates
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToState(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<State>,
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
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}

	// Send the initial state
	const initialState = await controller.getStateToPostToWebview()
	const initialStateJson = JSON.stringify(initialState)

	try {
		await responseStream(
			{
				stateJson: initialStateJson,
			},
			false, // Not the last message
		)
	} catch (error) {
		console.error("Error sending initial state:", error)
		streams.delete(responseStream)
	}
}

/**
 * Send a state update to the webview(s) of ONE controller.
 * @param state The state to send
 * @param controller The controller whose webview should repaint
 */
export async function sendStateUpdate(state: ExtensionState, controller: Controller): Promise<void> {
	const streams = activeStateSubscriptions.get(controller)
	if (!streams || streams.size === 0) {
		return
	}
	const stateJson = JSON.stringify(state)
	const promises = Array.from(streams).map(async (responseStream) => {
		try {
			await responseStream(
				{
					stateJson,
				},
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending state update:", error)
			// Remove the subscription if there was an error
			streams.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
