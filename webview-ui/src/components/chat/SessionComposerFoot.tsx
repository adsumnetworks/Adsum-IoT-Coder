import type React from "react"
import { R } from "@/components/rail/railStyles"
import { ADSUM_VIEW } from "@/config/platform.config"
import { BRAND_CORAL } from "./brandColors"

export interface SessionComposerFootProps {
	/** The open workspace folder's name (basename only — never the full path). */
	folderName?: string
	/** Context-window usage, 0-100, when a context window size is known. */
	contextPercent?: number
	/** Whether this tab already has a task. With none yet, the context percentage has nothing to measure,
	 *  so it stays hidden even if a stale value were ever passed in. Defaults to true, since most callers
	 *  only pass a defined `contextPercent` once a task exists anyway. */
	hasTask?: boolean
	/** Opens the palette dialog — the same one the rail's ⌘K opens — mounted by the caller (ChatView) in
	 *  the session view's own tree. This foot just asks for it; it owns no dialog state itself. */
	onOpenPalette: () => void
	/** Which surface this renders in. Defaults to the real `ADSUM_VIEW` — set only by tests and stories,
	 *  since `window.__ADSUM_VIEW__` is read once at module load and the real host never varies it. */
	view?: "sidebar" | "session"
}

/**
 * [P3.3 sessions first] A permanent, low-weight line under the session composer: the ◆ mark, the open
 * folder, the context-use percentage once a task exists, and a "Something else · ⌘K" handle. Session-tab
 * only — the sidebar (the rail) already carries this information in its own surfaces, so this would
 * double it there.
 */
const SessionComposerFoot: React.FC<SessionComposerFootProps> = ({
	folderName,
	contextPercent,
	hasTask = true,
	onOpenPalette,
	view = ADSUM_VIEW,
}) => {
	const isSession = view === "session"

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
				{hasTask && contextPercent !== undefined ? (
					<span className="shrink-0" title="Context window used">
						{Math.round(contextPercent)}% context
					</span>
				) : null}
			</span>
			<button
				aria-label="Something else"
				className="bg-transparent border-0 p-0 cursor-pointer shrink-0"
				onClick={onOpenPalette}
				style={{ ...R.meta, color: "var(--vscode-descriptionForeground)" }}
				type="button">
				Something else · ⌘K
			</button>
		</div>
	)
}

export default SessionComposerFoot
