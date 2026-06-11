import React from "react"
import { BRAND_CORAL, BRAND_CYAN_600, BRAND_CYAN_700, brandAlpha, brandSubtle } from "../brandColors"

interface IntentCardProps {
	icon: string
	title: string
	description: string
	primary?: boolean
	/** Small pill next to the title (e.g. "Start here"). Coming-soon cards show "Coming soon" automatically. */
	pill?: string
	/** Roadmap card: dashed/dimmed, non-interactive. */
	comingSoon?: boolean
	disabled?: boolean
	onClick: () => void
	testId?: string
}

// Neutral surfaces for the disabled "coming soon" roadmap cards.
const SOON_BORDER = "color-mix(in srgb, var(--vscode-foreground) 18%, transparent)"
const SOON_ICON_BG = "color-mix(in srgb, var(--vscode-foreground) 14%, transparent)"

const IntentCard: React.FC<IntentCardProps> = ({
	icon,
	title,
	description,
	primary = false,
	pill,
	comingSoon = false,
	disabled = false,
	onClick,
	testId,
}) => {
	const inert = disabled || comingSoon

	// Visual tier: hero (cyan) → coral (live) → neutral dashed (coming soon).
	const border = comingSoon ? SOON_BORDER : primary ? BRAND_CYAN_600 : brandAlpha(BRAND_CORAL, 0.6)
	const bg = comingSoon
		? "var(--vscode-input-background)"
		: primary
			? brandSubtle(BRAND_CYAN_600, 9)
			: "var(--vscode-input-background)"
	const iconBg = comingSoon ? SOON_ICON_BG : primary ? BRAND_CYAN_700 : BRAND_CORAL
	const iconColor = comingSoon ? "var(--vscode-descriptionForeground)" : "#fff"
	const pillText = comingSoon ? "Coming soon" : pill

	return (
		<button
			data-testid={testId}
			disabled={inert}
			onClick={inert ? undefined : onClick}
			onMouseEnter={(e) => {
				if (!inert) {
					e.currentTarget.style.transform = "translateY(-2px)"
					e.currentTarget.style.boxShadow = `0 4px 12px ${brandAlpha(primary ? BRAND_CYAN_600 : BRAND_CORAL, 0.18)}`
				}
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.transform = "none"
				e.currentTarget.style.boxShadow = "none"
			}}
			style={{
				width: "100%",
				padding: "14px 15px",
				background: bg,
				border: `2px ${comingSoon ? "dashed" : "solid"} ${border}`,
				borderRadius: "10px",
				cursor: inert ? "default" : "pointer",
				opacity: comingSoon ? 0.55 : 1,
				textAlign: "left",
				display: "flex",
				gap: "12px",
				alignItems: "flex-start",
				transition: "transform 0.12s, box-shadow 0.12s",
			}}
			type="button">
			<div
				style={{
					flexShrink: 0,
					width: "36px",
					height: "36px",
					borderRadius: "50%",
					background: iconBg,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: iconColor,
				}}>
				<i className={`codicon codicon-${icon}`} style={{ fontSize: "16px" }} />
			</div>

			<div style={{ flex: 1, minWidth: 0 }}>
				<div
					style={{
						fontSize: "13.5px",
						fontWeight: 700,
						color: "var(--vscode-foreground)",
						marginBottom: "3px",
						display: "flex",
						alignItems: "center",
						gap: "7px",
					}}>
					{title}
					{pillText && <Pill text={pillText} variant={comingSoon ? "soon" : "primary"} />}
				</div>
				<div
					style={{
						fontSize: "11.5px",
						color: "var(--vscode-descriptionForeground)",
						lineHeight: 1.45,
					}}>
					{description}
				</div>
			</div>
		</button>
	)
}

const Pill: React.FC<{ text: string; variant: "primary" | "soon" }> = ({ text, variant }) => (
	<span
		style={
			variant === "primary"
				? {
						fontSize: "9px",
						fontWeight: 700,
						padding: "2px 7px",
						borderRadius: "999px",
						background: BRAND_CYAN_600,
						color: "#04222b",
						letterSpacing: "0.04em",
						flexShrink: 0,
					}
				: {
						fontSize: "9px",
						fontWeight: 700,
						padding: "2px 7px",
						borderRadius: "999px",
						background: "color-mix(in srgb, var(--vscode-foreground) 12%, transparent)",
						color: "var(--vscode-descriptionForeground)",
						border: SOON_BORDER,
						textTransform: "uppercase",
						letterSpacing: "0.04em",
						flexShrink: 0,
					}
		}>
		{text}
	</span>
)

export default IntentCard
