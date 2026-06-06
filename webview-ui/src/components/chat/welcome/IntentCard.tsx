import React from "react"
import { BRAND_CORAL, BRAND_CYAN_600, brandAlpha, brandSubtle } from "../brandColors"

interface IntentCardProps {
	icon: string
	title: string
	description: string
	primary?: boolean
	disabled?: boolean
	onClick: () => void
	testId?: string
}

const IntentCard: React.FC<IntentCardProps> = ({
	icon,
	title,
	description,
	primary = false,
	disabled = false,
	onClick,
	testId,
}) => {
	const baseBg = primary ? brandSubtle(BRAND_CORAL, 5) : "var(--vscode-input-background)"
	const baseBorder = primary ? brandAlpha(BRAND_CORAL, 0.75) : brandAlpha(BRAND_CORAL, 0.45)

	return (
		<button
			data-testid={testId}
			disabled={disabled}
			onClick={onClick}
			onMouseEnter={(e) => {
				if (!disabled) {
					e.currentTarget.style.borderColor = BRAND_CYAN_600
					e.currentTarget.style.background = brandSubtle(BRAND_CYAN_600, 8)
					e.currentTarget.style.transform = "translateY(-2px)"
					e.currentTarget.style.boxShadow = `0 4px 12px ${brandAlpha(BRAND_CYAN_600, 0.15)}`
				}
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.borderColor = baseBorder
				e.currentTarget.style.background = baseBg
				e.currentTarget.style.transform = "none"
				e.currentTarget.style.boxShadow = "none"
			}}
			style={{
				width: "100%",
				padding: "16px 20px",
				background: baseBg,
				border: `2px solid ${baseBorder}`,
				borderRadius: "8px",
				cursor: disabled ? "default" : "pointer",
				opacity: disabled ? 0.5 : 1,
				pointerEvents: disabled ? "none" : "auto",
				textAlign: "left",
				transition: "transform 0.15s, box-shadow 0.15s, background 0.15s, border-color 0.15s",
			}}
			type="button">
			<div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
				<span
					style={{
						fontSize: "20px",
						flexShrink: 0,
						lineHeight: 1,
						marginTop: "1px",
					}}>
					{icon}
				</span>
				<div style={{ flex: 1 }}>
					<div
						style={{
							fontSize: "15px",
							fontWeight: primary ? 700 : 600,
							color: "var(--vscode-foreground)",
							marginBottom: "3px",
						}}>
						{title}
					</div>
					<div
						style={{
							fontSize: "12px",
							color: "var(--vscode-descriptionForeground)",
							lineHeight: 1.5,
						}}>
						{description}
					</div>
				</div>
			</div>
		</button>
	)
}

export default IntentCard
