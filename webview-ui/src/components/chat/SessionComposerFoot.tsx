import type React from "react"
import { useEffect } from "react"
import { openSession } from "@/components/rail/openSession"
import { R } from "@/components/rail/railStyles"
import { ADSUM_VIEW } from "@/config/platform.config"
import { BRAND_CORAL } from "./brandColors"

export interface SessionComposerFootProps {
	/** The open workspace folder's name (basename only — never the full path). */
	folderName?: string
	/** Context-window usage, 0-100, when a context window size is known. */
	contextPercent?: number
	/** Which surface this renders in. Defaults to the real `ADSUM_VIEW` — set only by tests and stories,
	 *  since `window.__ADSUM_VIEW__` is read once at module load and the real host never varies it. */
	view?: "sidebar" | "session"
}

/**
 * [P3.3 sessions first] A permanent, low-weight line under the session composer: the ◆ mark, the open
 * folder, the context-use percentage when it is known, and a "Something else · ⌘K" handle that starts a
 * fresh session. Session-tab only — the sidebar (the rail) already carries this information in its own
 * surfaces, so this would double it there.
 */
const SessionComposerFoot: React.FC<SessionComposerFootProps> = ({ folderName, contextPercent, view = ADSUM_VIEW }) => {
	const isSession = view === "session"

	const handleSomethingElse = () => {
		// [P3.3] Palette.tsx (what "⌘K" opens today) only renders inside RailView's own React tree — the
		// rail/sidebar webview — and a session tab is a SEPARATE webview with no state in common with it,
		// so the dialog itself cannot be reached from here without new host-side plumbing. The nearest
		// already-wired equivalent reachable from a session tab is the same `openSession` gRPC call
		// RailSessions' "New" button already makes (see openSession.ts): it asks the host to open a fresh
		// session tab, which is the one door this surface can open without duplicating or rebuilding the
		// rail's dialog.
		void openSession({})
	}

	useEffect(() => {
		if (!isSession) {
			return
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault()
				handleSomethingElse()
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [isSession])

	// Never in the sidebar view — the rail has its own equivalents for every piece of this line.
	if (!isSession) {
		return null
	}

	return (
		<div
			className="flex items-center justify-between gap-2"
			data-testid="session-composer-foot"
			style={{ ...R.meta, padding: "2px 14px 0" }}>
			<span className="flex items-center gap-1.5 min-w-0 overflow-hidden">
				<span aria-hidden="true" style={{ color: BRAND_CORAL }}>
					◆
				</span>
				{folderName ? <span className="truncate">{folderName}</span> : null}
				{contextPercent !== undefined ? (
					<span className="shrink-0" title="Context window used">
						{Math.round(contextPercent)}% context
					</span>
				) : null}
			</span>
			<button
				aria-label="Something else"
				className="bg-transparent border-0 p-0 cursor-pointer shrink-0"
				onClick={handleSomethingElse}
				style={{ ...R.meta, color: "var(--vscode-descriptionForeground)" }}
				type="button">
				Something else · ⌘K
			</button>
		</div>
	)
}

export default SessionComposerFoot
