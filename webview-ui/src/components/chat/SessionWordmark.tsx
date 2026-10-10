import type React from "react"
import AdsumLogo from "@/components/common/AdsumLogo"
import { ADSUM_VIEW } from "@/config/platform.config"

export interface SessionWordmarkProps {
	/** Defaults to the real `ADSUM_VIEW`; a test or story sets it directly. */
	view?: "sidebar" | "session"
}

/**
 * [0.5 sessions first] The product's own mark and name, centred, at the top of a brand-new session tab —
 * the one moment a tab has nothing else to show. Nothing else sits in this header; the one-line hint and
 * the EmptySession content (the "New session" line and, while new to the folder, the First steps /
 * What's new cards) sit below it, never beside it.
 *
 * The caller decides WHEN: ChatView mounts this next to EmptySession, in the exact branch that already
 * gates on no task existing, so once a task starts this unmounts with EmptySession and SessionHeader
 * takes the header role instead. This component only answers WHERE (session view, not sidebar).
 */
const SessionWordmark: React.FC<SessionWordmarkProps> = ({ view = ADSUM_VIEW }) => {
	if (view !== "session") {
		return null
	}
	return (
		<div data-testid="session-wordmark" style={{ display: "flex", justifyContent: "center", padding: "28px 0 2px" }}>
			<AdsumLogo size={40} />
		</div>
	)
}

export default SessionWordmark
