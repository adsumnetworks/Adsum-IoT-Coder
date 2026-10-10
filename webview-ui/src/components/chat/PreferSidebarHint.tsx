import type React from "react"
import { useState } from "react"
import { R } from "@/components/rail/railStyles"
import { ADSUM_VIEW } from "@/config/platform.config"

export interface PreferSidebarHintProps {
	/** Defaults to the real `ADSUM_VIEW`; a test or story sets it directly. */
	view?: "sidebar" | "session"
}

/**
 * [0.5 sessions first] One line above the composer in a brand-new session tab, for a developer who
 * still expects the old sidebar: the rail is still there, and ⌘K reaches what the sidebar used to show.
 * Dismissed for the session only — no localStorage key, unlike First steps or What's new, so it is
 * simply gone until the next empty tab, never a standing control once someone has seen it once.
 */
const PreferSidebarHint: React.FC<PreferSidebarHintProps> = ({ view = ADSUM_VIEW }) => {
	const [dismissed, setDismissed] = useState(false)

	if (view !== "session" || dismissed) {
		return null
	}

	return (
		<div
			className="flex items-center justify-between gap-2"
			data-testid="prefer-sidebar-hint"
			style={{ ...R.meta, padding: "2px 14px" }}>
			<span>Prefer the sidebar? The rail is always there; ⌘K opens the palette.</span>
			<button
				aria-label="Dismiss"
				onClick={() => setDismissed(true)}
				style={{
					background: "none",
					border: "none",
					cursor: "pointer",
					fontSize: 12,
					lineHeight: 1,
					color: "var(--vscode-descriptionForeground)",
					opacity: 0.6,
					padding: "2px 4px",
					flex: "none",
				}}
				type="button">
				×
			</button>
		</div>
	)
}

export default PreferSidebarHint
