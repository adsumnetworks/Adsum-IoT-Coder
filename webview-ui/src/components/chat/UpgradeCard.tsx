import { cardTitle, RELEASE_NOTES } from "@shared/releaseNotes"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { BRAND_CORAL, BRAND_CYAN_TEXT, BRAND_CYAN_UI, brandAlpha, brandSubtle } from "./brandColors"

interface UpgradeCardProps {
	onDismiss: () => void
	/**
	 * The one thing this release's card may start (RELEASE_NOTES.card.action). Omitted when it no longer
	 * applies to this user, e.g. "Register free" for someone already registered; the card is then
	 * dismiss-only, as it always was.
	 */
	onAction?: () => void
}

/**
 * Shown once per announced version to a returning user who has not activated it. Every word here comes
 * from RELEASE_NOTES: the title, the three lines, the action label and the changelog link. This file owns
 * the shape only, so a release review never has to open it.
 *
 * Colour keeps one meaning each: the coral frame is identity ("this is from us"), the cyan button is the
 * action, the link is cyan because it goes somewhere. The action is optional by design: a release with
 * nothing worth a click ships without a button rather than with a button that does nothing.
 */
const UpgradeCard: React.FC<UpgradeCardProps> = ({ onDismiss, onAction }) => {
	const { lines, action, link } = RELEASE_NOTES.card
	return (
		<div
			data-testid="upgrade-card"
			style={{
				width: "100%",
				marginBottom: "20px",
				borderRadius: "10px",
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.5)}`,
				background: brandSubtle(BRAND_CORAL, 4),
				padding: "14px 16px",
				position: "relative",
			}}>
			<button
				aria-label="Dismiss"
				data-testid="upgrade-card-dismiss"
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
					paddingRight: "24px",
					display: "flex",
					alignItems: "center",
					gap: "7px",
				}}>
				<i className="codicon codicon-rocket" style={{ fontSize: "14px", color: BRAND_CORAL, flexShrink: 0 }} />
				{cardTitle()}
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "8px" }}>
				{lines.map((line) => (
					<div
						key={line.head}
						style={{
							display: "grid",
							gridTemplateColumns: "64px 1fr",
							gap: "8px",
							fontSize: "12px",
							lineHeight: 1.45,
							color: "var(--vscode-descriptionForeground)",
						}}>
						<span style={{ fontWeight: 600, color: "var(--vscode-foreground)" }}>{line.head}</span>
						<span>{line.body}</span>
					</div>
				))}
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					gap: "10px",
					marginTop: "10px",
				}}>
				<VSCodeLink href={link.href} style={{ color: BRAND_CYAN_TEXT, fontSize: "12px" }}>
					{link.label}
				</VSCodeLink>
				{action && onAction && (
					<button
						data-testid="upgrade-card-action"
						onClick={onAction}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = BRAND_CYAN_UI
							e.currentTarget.style.color = "#fff"
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = "transparent"
							e.currentTarget.style.color = BRAND_CYAN_TEXT
						}}
						style={{
							flexShrink: 0,
							background: "transparent",
							border: `1px solid ${BRAND_CYAN_UI}`,
							borderRadius: "5px",
							padding: "4px 10px",
							fontSize: "12px",
							fontWeight: 600,
							color: BRAND_CYAN_TEXT,
							cursor: "pointer",
							transition: "background 0.15s, color 0.15s",
						}}
						type="button">
						{action.label} ›
					</button>
				)}
			</div>
		</div>
	)
}

export default UpgradeCard
