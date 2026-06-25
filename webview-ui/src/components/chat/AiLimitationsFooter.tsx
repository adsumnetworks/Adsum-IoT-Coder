import type React from "react"

/**
 * Persistent AI-limitations disclaimer (design/13 A6). Shown on the welcome screen AND under the chat input
 * during a task — so "review before you flash or ship" is visible exactly when the dev is acting on the agent's
 * output, not only on the empty welcome screen. Single source of the copy (DRY across both surfaces).
 */
export const AI_LIMITATIONS_TEXT =
	"Adsum is an AI-based coding agent and can make mistakes — review its changes before you flash or ship."

const AiLimitationsFooter: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
	<div
		className="w-full"
		data-testid="ai-limitations-footer"
		style={{
			fontSize: "10.5px",
			color: "var(--vscode-descriptionForeground)",
			opacity: 0.75,
			lineHeight: 1.4,
			...style,
		}}>
		{AI_LIMITATIONS_TEXT}
	</div>
)

export default AiLimitationsFooter
