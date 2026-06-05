import React from "react"
import { BRAND_CORAL, BRAND_CYAN_700, brandAlpha, brandSubtle } from "./brandColors"

interface UpgradeCardProps {
	version: string
	onStartDemo: () => void
	onDismiss: () => void
}

/**
 * Shown once per version update when the user has not previously activated the tool.
 * Primary CTA launches the live demo; secondary dismisses.
 */
const UpgradeCard: React.FC<UpgradeCardProps> = ({ version, onStartDemo, onDismiss }) => {
	return (
		<div
			style={{
				width: "100%",
				marginBottom: "20px",
				borderRadius: "10px",
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.5)}`,
				background: brandSubtle(BRAND_CORAL, 4),
				padding: "14px 16px",
				position: "relative",
			}}>
			{/* Dismiss button */}
			<button
				aria-label="Dismiss"
				onClick={onDismiss}
				style={{
					position: "absolute",
					top: "10px",
					right: "12px",
					background: "none",
					border: "none",
					cursor: "pointer",
					fontSize: "16px",
					lineHeight: 1,
					color: "var(--vscode-descriptionForeground)",
					opacity: 0.6,
					padding: "2px 4px",
				}}
				type="button">
				×
			</button>

			<div
				style={{
					fontSize: "13px",
					fontWeight: 700,
					color: "var(--vscode-foreground)",
					marginBottom: "4px",
					paddingRight: "24px",
				}}>
				✦ What's new in v{version}
			</div>

			<div
				style={{
					fontSize: "12px",
					color: "var(--vscode-descriptionForeground)",
					marginBottom: "12px",
					lineHeight: 1.5,
				}}>
				Real-workspace debugging on live nRF hardware — with a free tier, no key needed to start.
			</div>

			<div style={{ display: "flex", gap: "8px" }}>
				<button
					onClick={onStartDemo}
					onMouseEnter={(e) => {
						e.currentTarget.style.background = BRAND_CYAN_700
					}}
					onMouseLeave={(e) => {
						e.currentTarget.style.background = BRAND_CYAN_700
					}}
					style={{
						background: BRAND_CYAN_700,
						color: "#fff",
						border: "none",
						borderRadius: "6px",
						padding: "6px 12px",
						fontSize: "12px",
						fontWeight: 600,
						cursor: "pointer",
					}}
					type="button">
					▶ See it live
				</button>
				<a
					href="https://www.youtube.com/@adsumnetworks"
					rel="noopener noreferrer"
					style={{
						display: "inline-flex",
						alignItems: "center",
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						textDecoration: "none",
						padding: "6px 0",
					}}
					target="_blank">
					Watch 60s video ↗
				</a>
			</div>
		</div>
	)
}

export default UpgradeCard
