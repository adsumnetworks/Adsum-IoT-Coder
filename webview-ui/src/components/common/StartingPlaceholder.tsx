import type React from "react"

/**
 * [0.5.1 bench] What a webview shows between its script loading and the host's first state. It used to be
 * nothing: the page's own loading mark was replaced by an empty page, and a session tab opened from a button
 * looked dead until the state arrived. One centred line, in the empty state's quiet type, that reads the same
 * in a session tab and in the narrow sidebar.
 */
const StartingPlaceholder: React.FC = () => (
	<div
		aria-live="polite"
		data-testid="starting-placeholder"
		role="status"
		style={{
			height: "100vh",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			gap: 8,
			padding: "0 16px",
			boxSizing: "border-box",
			fontSize: 12.5,
			lineHeight: 1.5,
			color: "var(--vscode-descriptionForeground)",
		}}>
		<span aria-hidden="true" className="codicon codicon-loading codicon-modifier-spin" style={{ fontSize: 14 }} />
		Starting…
	</div>
)

export default StartingPlaceholder
