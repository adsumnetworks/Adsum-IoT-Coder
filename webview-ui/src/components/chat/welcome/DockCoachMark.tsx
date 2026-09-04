import React, { useEffect, useState } from "react"

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
			style={{
				width: "100%",
				display: "flex",
				alignItems: "flex-start",
				gap: "6px",
				paddingLeft: "2px",
			}}>
			<p
				style={{
					margin: 0,
					fontSize: "11px",
					color: "var(--vscode-descriptionForeground)",
					lineHeight: 1.5,
					flex: 1,
				}}>
				Drag Adsum to the right side bar to see your files, code, and chat together (⌘⌥B / Ctrl+Alt+B).
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
