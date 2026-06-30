import React from "react"
import { BRAND_CORAL, BRAND_CYAN_600, brandAlpha, brandSubtle } from "../brandColors"

interface TenureNudgeProps {
	onStartDemo: () => void
}

/** First-run "new user" nudge — shown only for tenure="new". Dormant users get UpgradeCard instead. */
const TenureNudge: React.FC<TenureNudgeProps> = ({ onStartDemo }) => {
	return (
		<div
			style={{
				width: "100%",
				marginBottom: "16px",
				borderRadius: "8px",
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.4)}`,
				background: brandSubtle(BRAND_CORAL, 6),
				padding: "12px 14px",
				display: "flex",
				alignItems: "center",
				gap: "10px",
			}}>
			<i className="codicon codicon-star-empty" style={{ fontSize: "16px", flexShrink: 0, color: BRAND_CORAL }} />
			<div style={{ flex: 1 }}>
				<div
					style={{
						fontSize: "13px",
						fontWeight: 600,
						color: "var(--vscode-foreground)",
						marginBottom: "2px",
					}}>
					New here?
				</div>
				<div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
					Try Adsum on a real BLE bug — no setup, no hardware needed.
				</div>
			</div>
			<button
				onClick={onStartDemo}
				onMouseEnter={(e) => {
					e.currentTarget.style.background = BRAND_CYAN_600
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.background = "transparent"
				}}
				style={{
					flexShrink: 0,
					background: "transparent",
					border: `1px solid ${BRAND_CYAN_600}`,
					borderRadius: "5px",
					padding: "5px 10px",
					fontSize: "12px",
					fontWeight: 600,
					color: BRAND_CYAN_600,
					cursor: "pointer",
					transition: "background 0.15s, color 0.15s",
				}}
				type="button">
				Try it ›
			</button>
		</div>
	)
}

export default TenureNudge
