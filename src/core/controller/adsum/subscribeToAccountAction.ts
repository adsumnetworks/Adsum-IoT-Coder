import { EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

export type AccountAction = "signin" | "settings" | "signout"

const subscribers = new Set<StreamingResponseHandler<ProtoString>>()

/** The panel listens for what the header's account icon asks it to show. */
export async function subscribeToAccountAction(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ProtoString>,
	requestId?: string,
): Promise<void> {
	subscribers.add(responseStream)
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			() => subscribers.delete(responseStream),
			{ type: "account_action_subscription" },
			responseStream,
		)
	}
}

export async function sendAccountAction(action: AccountAction): Promise<void> {
	await Promise.all(
		Array.from(subscribers).map(async (stream) => {
			try {
				await stream(ProtoString.create({ value: action }), false)
			} catch {
				subscribers.delete(stream)
			}
		}),
	)
}
