import type React from "react"

/**
 * Persistent AI-limitations disclaimer (design/13 A6) — the exact spec'd copy + the "Full disclaimer →" link.
 * Shown on the welcome screen AND under the chat input during a task, so it's visible while the dev acts on the
 * agent's output, not only on the empty welcome screen. Single source of the copy + the link target (DRY).
 *
 * The link target is LIVE: adsumnetworks.com 302-redirects to the docs site (docs.adsumnetworks.com) and the
 * redirect drops the path, so we link the docs URL directly (page-before-link: the page ships in adsumcoder-docs).
 */
export const AI_LIMITATIONS_TEXT = "Adsum is an AI-based coding agent and can make mistakes."
export const DISCLAIMER_URL = "https://docs.adsumnetworks.com/legal/limitations"

const AiLimitationsFooter: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
	<div
		className="w-full"
		data-testid="ai-limitations-footer"
		style={{
			fontSize: "10.5px",
			color: "var(--vscode-descriptionForeground)",
			opacity: 0.75,
			lineHeight: 1.4,
			textAlign: "center",
			...style,
		}}>
		{AI_LIMITATIONS_TEXT}{" "}
		<a
			data-testid="ai-limitations-link"
			href={DISCLAIMER_URL}
			rel="noreferrer"
			style={{ color: "var(--vscode-textLink-foreground)" }}
			target="_blank">
			Full disclaimer →
		</a>
	</div>
)

export default AiLimitationsFooter
