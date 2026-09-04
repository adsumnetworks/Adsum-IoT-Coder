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
 * (its former parent, WelcomeSection, was dead and has been deleted along with HistoryPreview). So this
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
				What's new in v{version} — cellular, partner open hardware, and downloadable Tool bits
			</div>

			<div
				style={{
					fontSize: "12px",
					color: "var(--vscode-descriptionForeground)",
					marginBottom: 0,
					lineHeight: 1.5,
				}}>
				nRF9160, nRF9161 and nRF9151 with NB-IoT, LTE-M and GNSS, plus a board shell and a modem trace for bringing one
				up. On a Fanstel gateway the product knowledge already holds the pinouts. And the loggers, sniffer and scan
				engines are Tool bits now: downloaded on demand, credited, and hash-verified before they run.
			</div>
		</div>
	)
}

export default UpgradeCard
