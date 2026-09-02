import { StringRequest } from "@shared/proto/cline/common"
import React from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

/**
 * Messages the developer sent while the agent was working, waiting for the next turn boundary.
 *
 * Rendered at the tail of the transcript, which is where the real message will appear when it is
 * delivered — so a queued row does not move when it becomes a bubble, it is simply replaced by one. They
 * exist because the alternative is a message that vanishes into a queue with nothing on screen to say it
 * was taken: the developer would not know whether to say it again.
 *
 * Grey throughout, and deliberately: waiting is not a warning. Colour in this product means status, never
 * a verdict on what the developer did.
 */

/** Why a message could not be queued, said in terms of what the developer should do about it. */
const REFUSALS: Record<string, string> = {
	full: "Five messages are already waiting — they go in with the agent's next step. Remove one or wait; your text is still here.",
	no_task: "Nothing is running to receive this. Send it as a message.",
	aborted: "That run has stopped, so there is nothing to queue this for. Send it as a message.",
	invalid: "That message could not be queued — it is either empty or too long for a note.",
	error: "Couldn't queue that. Your text is still in the box — try again, or stop the run and send it.",
	unreachable: "Couldn't queue that. Your text is still in the box — try again, or stop the run and send it.",
}

interface QueuedMessagesProps {
	queueRefusal: string | null
}

export const QueuedMessages: React.FC<QueuedMessagesProps> = ({ queueRefusal }) => {
	const { queuedUserMessages } = useExtensionState()
	const queued = queuedUserMessages ?? []

	if (queued.length === 0 && !queueRefusal) {
		return null
	}

	const remove = (id: string) => {
		TaskServiceClient.removeQueuedUserMessage(StringRequest.create({ value: id })).catch((err) => console.error(err))
	}

	return (
		<div style={{ padding: "4px 20px 0 20px", display: "flex", flexDirection: "column", gap: "8px" }}>
			{queued.map((message) => (
				<div data-testid="queued-message" key={message.id}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "6px",
							fontSize: "10px",
							color: "var(--vscode-descriptionForeground)",
							fontWeight: 700,
							marginBottom: "3px",
						}}>
						<span>
							{message.source === "seam" && message.from ? message.from : "you"} · queued — delivers with the
							agent's next step
						</span>
						<button
							aria-label="Remove queued message"
							onClick={() => remove(message.id)}
							style={{
								marginLeft: "auto",
								background: "transparent",
								border: "none",
								padding: "0 2px",
								cursor: "pointer",
								color: "var(--vscode-descriptionForeground)",
								fontWeight: 400,
							}}
							title="Remove this message before it is sent"
							type="button">
							✕
						</button>
					</div>
					<div
						style={{
							fontSize: "12.5px",
							lineHeight: 1.55,
							color: "var(--vscode-foreground)",
							opacity: 0.75,
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
						}}>
						{message.text}
					</div>
					{(message.images?.length || message.files?.length) && (
						<Thumbnails files={message.files ?? []} images={message.images ?? []} style={{ marginTop: "4px" }} />
					)}
				</div>
			))}
			{queueRefusal && (
				<div
					data-testid="queue-refusal"
					style={{
						fontSize: "11px",
						lineHeight: 1.5,
						color: "var(--vscode-descriptionForeground)",
					}}>
					{REFUSALS[queueRefusal] ?? REFUSALS.unreachable}
				</div>
			)}
		</div>
	)
}

export default QueuedMessages
