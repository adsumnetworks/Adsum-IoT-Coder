import React, { useEffect, useState } from "react"
import { getCurrentPlatform } from "@/utils/platformUtils"

const DISMISSED_KEY = "adsum.dockCoachMarkDismissed"

interface DockCoachMarkProps {
	hasProject: boolean
}

/**
 * One-time dismissible tip: drag Adsum to the right side bar to see files, code, and chat together.
 * Shows only when a project is open (the layout tip matters once they're actually working).
 * Persisted via localStorage so it stays gone after reload.
 *
 * One quiet line, not a card. [SCREENSHOT 2026-09-04] As a bordered box with a lightbulb it was
 * taller and louder than the resume card above it — a one-time layout hint outranking the
 * developer's own unfinished work.
 */
const DockCoachMark: React.FC<DockCoachMarkProps> = ({ hasProject }) => {
	const [visible, setVisible] = useState(false)

	useEffect(() => {
		if (hasProject && localStorage.getItem(DISMISSED_KEY) !== "1") {
			setVisible(true)
		}
	}, [hasProject])

	if (!visible) {
		return null
	}

	const dismiss = () => {
		localStorage.setItem(DISMISSED_KEY, "1")
		setVisible(false)
	}

	return (
		<div
			// Chrome, not content. [SWEEP 2026-09-04, F6] Placed above the cards at the same size as
			// the instruction line it read as the first paragraph of the surface, and in the
			// returning state it sat flush against the resume card. A lightbulb glyph, a smaller
			// size and a bottom margin make it read as the last line of the environment band —
			// something the panel says about itself, not something it wants you to do next.
			style={{
				width: "100%",
				display: "flex",
				alignItems: "flex-start",
				gap: "6px",
				paddingLeft: "2px",
				marginTop: "4px",
			}}>
			<span
				aria-hidden="true"
				className="codicon codicon-lightbulb"
				style={{ fontSize: "11px", marginTop: "2px", color: "var(--vscode-descriptionForeground)", opacity: 0.8 }}
			/>
			<p
				style={{
					margin: 0,
					fontSize: "11px",
					color: "var(--vscode-descriptionForeground)",
					lineHeight: 1.5,
					flex: 1,
				}}>
				{/* [F11] The host knows which OS it is on; showing both shortcuts made the line half
				    noise on every machine. */}
				Drag Adsum to the right side bar to see files, code and chat together (
				{getCurrentPlatform() === "windows" ? "Ctrl+Alt+B" : "⌘⌥B"}).
			</p>
			<button
				aria-label="Dismiss"
				onClick={dismiss}
				style={{
					flexShrink: 0,
					background: "none",
					border: "none",
					cursor: "pointer",
					fontSize: "12px",
					lineHeight: 1,
					color: "var(--vscode-descriptionForeground)",
					opacity: 0.6,
					padding: "2px 4px",
				}}
				type="button">
				×
			</button>
		</div>
	)
}

export default DockCoachMark
