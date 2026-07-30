import React from "react"
import { BRAND_CORAL, BRAND_CYAN_600, brandAlpha, brandSubtle } from "../brandColors"

interface ReviewNudgeProps {
	onReview: () => void
	onDismiss: () => void
}

/**
 * A gentle, one-time "leave a review" nudge on the welcome screen, shown after a few successful task completions
 * (eligibility computed host-side). Both the CTA and the dismiss retire it for good via the banner-dismissal ledger
 * (id "review-nudge"), so it never nags. Not a verdict, not blocking — a quiet ask, once.
 */
const ReviewNudge: React.FC<ReviewNudgeProps> = ({ onReview, onDismiss }) => {
	return (
		<div
			data-testid="review-nudge"
			style={{
				width: "100%",
				position: "relative",
				display: "flex",
				gap: "12px",
				padding: "12px 14px",
				background: brandSubtle(BRAND_CORAL, 8),
				border: `1px solid ${brandAlpha(BRAND_CORAL, 0.5)}`,
				borderRadius: "10px",
			}}>
			<button
				aria-label="Dismiss"
				data-testid="review-nudge-dismiss"
				onClick={onDismiss}
				style={{
					position: "absolute",
					top: "6px",
					right: "8px",
					background: "transparent",
					border: "none",
					color: "var(--vscode-descriptionForeground)",
					cursor: "pointer",
					fontSize: "12px",
					lineHeight: 1,
					padding: "2px",
				}}
				type="button">
				<i className="codicon codicon-close" />
			</button>

			<div
				style={{
					flexShrink: 0,
					width: "28px",
					height: "28px",
					borderRadius: "50%",
					background: BRAND_CORAL,
					color: "#fff",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}>
				<i className="codicon codicon-star-full" style={{ fontSize: "15px" }} />
			</div>

			<div style={{ flex: 1, minWidth: 0, paddingRight: "12px" }}>
				<div style={{ fontSize: "13px", fontWeight: 700, color: "var(--vscode-foreground)" }}>Enjoying Adsum?</div>
				<div
					style={{
						fontSize: "11.5px",
						color: "var(--vscode-descriptionForeground)",
						marginTop: "4px",
						lineHeight: 1.45,
					}}>
					If it saved you time, a quick review helps other embedded engineers find it.{" "}
					<button
						data-testid="review-nudge-cta"
						onClick={onReview}
						style={{
							background: "transparent",
							border: "none",
							padding: 0,
							color: BRAND_CYAN_600,
							fontWeight: 700,
							cursor: "pointer",
							fontSize: "11.5px",
						}}
						type="button">
						Leave a review →
					</button>
				</div>
			</div>
		</div>
	)
}

export default ReviewNudge
