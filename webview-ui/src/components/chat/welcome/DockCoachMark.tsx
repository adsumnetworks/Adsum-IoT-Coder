import React, { useEffect, useState } from "react"
import { brandAlpha } from "../brandColors"

const DISMISSED_KEY = "adsum.dockCoachMarkDismissed"

interface DockCoachMarkProps {
	hasProject: boolean
}

/**
 * One-time dismissible tip: drag Adsum to the right side bar to see files, code, and chat together.
 * Shows only when a project is open (the layout tip matters once they're actually working).
 * Persisted via localStorage so it stays gone after reload.
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
				marginTop: "12px",
				borderRadius: "6px",
				border: `1px solid ${brandAlpha("#888888", 0.3)}`,
				background: "var(--vscode-input-background)",
				padding: "10px 12px",
				display: "flex",
				alignItems: "flex-start",
				gap: "8px",
				position: "relative",
			}}>
			<i
				className="codicon codicon-lightbulb"
				style={{ fontSize: "14px", flexShrink: 0, marginTop: "1px", color: "var(--vscode-foreground)" }}
			/>
			<p
				style={{
					margin: 0,
					fontSize: "12px",
					color: "var(--vscode-descriptionForeground)",
					lineHeight: 1.5,
					flex: 1,
					paddingRight: "20px",
				}}>
				<strong style={{ color: "var(--vscode-foreground)" }}>Tip:</strong> Drag Adsum to the right side bar to see your
				files, code, and chat together (⌘⌥B / Ctrl+Alt+B).
			</p>
			<button
				aria-label="Dismiss"
				onClick={dismiss}
				style={{
					position: "absolute",
					top: "8px",
					right: "10px",
					background: "none",
					border: "none",
					cursor: "pointer",
					fontSize: "14px",
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
