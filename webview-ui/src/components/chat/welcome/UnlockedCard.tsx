import React from "react"
import { BRAND_CYAN_600, BRAND_CYAN_TEXT, BRAND_CYAN_UI, brandSubtle } from "../brandColors"

/**
 * "You're registered — cellular is unlocked." Shown once, then never again.
 *
 * It exists because the moment after signing in is the only moment where the developer is asking
 * "what did that get me?", and a surface that silently changes four card frames does not answer it.
 * It names what is now theirs, and — deliberately — what still is not: template source is by
 * request, and saying so here is what stops the next click being a disappointment.
 */

interface UnlockedCardProps {
	onDismiss: () => void
}

const UnlockedCard: React.FC<UnlockedCardProps> = ({ onDismiss }) => (
	<div
		data-testid="unlocked-card"
		style={{
			position: "relative",
			border: `1px solid ${BRAND_CYAN_UI}`,
			background: brandSubtle(BRAND_CYAN_600, 9),
			borderRadius: "10px",
			padding: "12px 34px 12px 14px",
		}}>
		<button
			aria-label="Dismiss"
			data-testid="unlocked-dismiss"
			onClick={onDismiss}
			style={{
				position: "absolute",
				top: "8px",
				right: "8px",
				background: "none",
				border: "none",
				cursor: "pointer",
				color: "var(--vscode-descriptionForeground)",
				fontSize: "14px",
				lineHeight: 1,
				padding: "2px 5px",
			}}
			type="button">
			×
		</button>
		<div style={{ fontSize: "13px", fontWeight: 600, color: "var(--vscode-foreground)", marginBottom: "5px" }}>
			<i className="codicon codicon-check" style={{ fontSize: "12px", color: BRAND_CYAN_TEXT, marginRight: "6px" }} />
			You’re registered — cellular is unlocked
		</div>
		<ul
			style={{
				margin: 0,
				paddingLeft: "18px",
				fontSize: "12px",
				lineHeight: 1.6,
				color: "var(--vscode-descriptionForeground)",
			}}>
			<li>Advanced cellular knowledge: LTE-M, NB-IoT, NTN, DECT NR+</li>
			<li>On-device inference on nRF54</li>
			<li>Fanstel LEW840x demo hexes</li>
		</ul>
		<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", marginTop: "7px" }}>
			Template source is by request — the LEW840x card has the link.
		</div>
	</div>
)

export default UnlockedCard
