import type { ClineMessage } from "@shared/ExtensionMessage"
import type React from "react"
import { R } from "@/components/rail/railStyles"
import { ADSUM_VIEW } from "@/config/platform.config"
import { filterVisibleMessages } from "./chat-view/utils/messageUtils"

/** What a session with nothing under its first message is doing. */
export type SessionStartState = "starting" | "stopped" | null

/**
 * [0.5.1 bench] A session opened from a Hardware page button showed a header and nothing else for a long time:
 * the first message is in the header, and no row exists until the first request starts. This says which of the
 * two empty states it is, from the transcript alone.
 *
 *  - "starting": the first message is all there is. The host is on its way to the first request.
 *  - "stopped": the first message, then the host asking to resume. A session reopened from history gets that
 *    ask and nothing else when it ended before its first reply.
 *  - null: any row at all (the first request, an error, a reply), or no session. The transcript speaks for itself.
 *
 * "Row" is what the chat draws: bookkeeping messages the list never shows do not count as a start.
 */
export function sessionStartNotice(messages: readonly ClineMessage[]): SessionStartState {
	if (messages.length === 0) {
		return null
	}
	const rest = messages.slice(1)
	if (filterVisibleMessages(rest).length > 0) {
		return null
	}
	const last = rest.at(-1)
	if (last?.type === "ask" && last.ask === "resume_task") {
		return "stopped"
	}
	// Any other ask with no row above it is a state this line has no words for: say nothing.
	return rest.some((m) => m.type === "ask") ? null : "starting"
}

export interface SessionStartNoticeProps {
	messages: readonly ClineMessage[]
	/** Defaults to the real `ADSUM_VIEW`; a story or a test sets it directly. */
	view?: "sidebar" | "session"
}

/**
 * The one quiet line under a session's first message while there is nothing else to show, in the worklog's own
 * meta style. It is gone as soon as the first row arrives. Session tab only: the sidebar's chat has its own header.
 */
const SessionStartNotice: React.FC<SessionStartNoticeProps> = ({ messages, view = ADSUM_VIEW }) => {
	const state = view === "session" ? sessionStartNotice(messages) : null
	if (!state) {
		return null
	}
	return (
		<div
			aria-live="polite"
			data-state={state}
			data-testid="session-start-notice"
			role="status"
			style={{ ...R.meta, display: "flex", alignItems: "center", gap: 6, padding: "6px 16px 2px" }}>
			{state === "starting" ? (
				<>
					<span aria-hidden="true" className="codicon codicon-loading codicon-modifier-spin" style={{ fontSize: 12 }} />
					Starting…
				</>
			) : (
				// Enter on an empty box sends nothing; the send arrow is what resumes a stopped session.
				"This session stopped before the first reply. Press the send arrow to send it again."
			)}
		</div>
	)
}

export default SessionStartNotice
