import React from "react"
import { BRAND_CORAL, brandAlpha, brandSubtle } from "./brandColors"

interface UpgradeCardProps {
	version: string
	onDismiss: () => void
}

/**
 * Shown once per version update to a returning user who has not activated this version. An informational
 * "what's new" notice — dismiss is the only action. No CTA button: the only demo it could launch (the CRA
 * sample) duplicates the demo already on the welcome screen, and no one click can show the model picker
 * (a setting, not a run). The user acts on their own; the sample stays one click away in the picker below.
 *
 * This is the ONLY "what's new" surface that reaches a user in the panel — `WhatsNewModal` is unreachable
 * (its sole parent, WelcomeSection, is imported by nothing and neither appears in the built bundle). So this
 * copy and the `whatsNewToastMessage` one-liner are what must be refreshed every release.
 */
const UpgradeCard: React.FC<UpgradeCardProps> = ({ version, onDismiss }) => {
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
					display: "flex",
					alignItems: "center",
					gap: "7px",
				}}>
				{/* Coral rocket = identity/"what's new" framing on this coral nudge (on-palette). */}
				<i className="codicon codicon-rocket" style={{ fontSize: "14px", color: BRAND_CORAL, flexShrink: 0 }} />
				What's new in v{version} — project memory, longer sessions, and cheaper logs
			</div>

			<div
				style={{
					fontSize: "12px",
					color: "var(--vscode-descriptionForeground)",
					marginBottom: 0,
					lineHeight: 1.5,
				}}>
				An <code>.adsum/</code> folder remembers your board, goal and open bugs between chats. Context bugs are fixed and
				compaction warns you first. Captures are searched by pattern instead of read whole — one went from 333,000 tokens
				to a few thousand. Plus deeper nRF54L knowledge and native DeepSeek.
			</div>
		</div>
	)
}

export default UpgradeCard
