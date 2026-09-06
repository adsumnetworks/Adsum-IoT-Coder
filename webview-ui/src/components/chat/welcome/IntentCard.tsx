import React from "react"
import { BRAND_CORAL, BRAND_CYAN_600, BRAND_CYAN_700, BRAND_CYAN_UI, brandAlpha, brandSubtle } from "../brandColors"

interface IntentCardProps {
	icon: string
	title: string
	description: string
	primary?: boolean
	/** Small pill next to the title (e.g. "Start here"). Coming-soon cards show "Coming soon" automatically. */
	pill?: string
	/** Optional one-line capability sub-line under the description (e.g. the A10 deep-debug ladder). */
	subline?: string
	/** Colour for that sub-line. Defaults to the muted description grey; the entry surface passes
	 *  brand cyan so the SAME fact — why this run is suggested — is not cyan in the drawer and grey
	 *  on a card. One meaning, one colour. */
	sublineColor?: string
	/** Roadmap card: dashed/dimmed, non-interactive. */
	comingSoon?: boolean
	/**
	 * Behind the register gate. Still clickable — that is the whole point: the click is what opens the
	 * gate. SOLID grey frame, never dashed: dashed already means "on the roadmap", and a card that is
	 * available the moment you register must not read as a card that does not exist yet.
	 */
	locked?: boolean
	/** Called instead of onClick while locked, so a locked card can never start the work it names. */
	onLocked?: () => void
	/** Agent-mode route marker ("→ your agent") — the run-target picker's point-of-action signal. */
	routeChip?: string
	/** Honest caveat shown only while this card routes to the agent (e.g. model-dependent quality). */
	caveat?: string
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
	subline,
	sublineColor,
	comingSoon = false,
	locked = false,
	onLocked,
	routeChip,
	caveat,
	disabled = false,
	onClick,
	testId,
}) => {
	const inert = disabled || comingSoon
	// A locked card is live to the finger and inert to the work. Routing the click here rather than
	// guarding inside onClick is what makes it impossible for a card to run what it is gating.
	const activate = locked ? onLocked : onClick

	// Visual tier: hero (cyan frame + cyan chip) → live (neutral frame, coral chip) → coming soon
	// (neutral dashed). [SWEEP 2026-09-04, F8] Secondary cards had coral FRAMES as well as coral
	// chips: coral is the identity colour and a coral frame reads as a warning in several themes,
	// and with three coloured frames on screen the one cyan frame stopped being singular. The chip
	// keeps the identity; the frame is the panel's own border, so exactly one card on the surface
	// has a coloured edge and it is the one the ranking put first.
	const border = comingSoon || locked ? SOON_BORDER : primary ? BRAND_CYAN_UI : "var(--vscode-panel-border)"
	const bg =
		comingSoon || locked
			? "var(--vscode-input-background)"
			: primary
				? brandSubtle(BRAND_CYAN_600, 9)
				: "var(--vscode-input-background)"
	const iconBg = comingSoon || locked ? SOON_ICON_BG : primary ? BRAND_CYAN_700 : BRAND_CORAL
	const iconColor = comingSoon || locked ? "var(--vscode-descriptionForeground)" : "#fff"
	const pillText = comingSoon ? "Roadmap" : pill
	// Grey is the "not now" colour, and locked is exactly that. Never coral (identity) or cyan
	// (action) — colour is never a verdict, and a locked card has not been judged, only gated.
	const pillVariant = comingSoon ? "soon" : locked ? "locked" : "primary"
	const glyph = locked ? "lock" : icon

	return (
		<button
			data-testid={testId}
			disabled={inert}
			onClick={inert ? undefined : activate}
			onMouseEnter={(e) => {
				if (!inert) {
					e.currentTarget.style.transform = "translateY(-2px)"
					e.currentTarget.style.boxShadow = locked
						? "0 4px 12px color-mix(in srgb, var(--vscode-foreground) 12%, transparent)"
						: `0 4px 12px ${brandAlpha(primary ? BRAND_CYAN_600 : BRAND_CORAL, 0.18)}`
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
				<i className={`codicon codicon-${glyph}`} style={{ fontSize: "16px" }} />
			</div>

			<div style={{ flex: 1, minWidth: 0 }}>
				<div
					style={{
						fontSize: "14px",
						fontWeight: 600,
						// 78%, not 55% opacity: a locked card is legible and readable, because reading it is
						// what makes registering worth doing. Dimming it to roadmap grey hides the offer.
						color: locked
							? "color-mix(in srgb, var(--vscode-foreground) 78%, transparent)"
							: "var(--vscode-foreground)",
						marginBottom: "3px",
						display: "flex",
						alignItems: "center",
						gap: "7px",
					}}>
					{title}
					{pillText && <Pill text={pillText} variant={pillVariant} />}
					{routeChip && (
						<span
							style={{
								fontSize: "10px",
								fontWeight: 600,
								color: BRAND_CYAN_700,
								border: `1px solid ${brandAlpha(BRAND_CYAN_600, 0.45)}`,
								borderRadius: "9px",
								padding: "1px 7px",
								whiteSpace: "nowrap",
							}}>
							{routeChip}
						</span>
					)}
				</div>
				<div
					style={{
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						lineHeight: 1.45,
					}}>
					{description}
				</div>
				{caveat && (
					<div
						style={{
							fontSize: "10px",
							color: "var(--vscode-descriptionForeground)",
							marginTop: "5px",
							lineHeight: 1.4,
							opacity: 0.9,
						}}>
						{caveat}
					</div>
				)}
				{subline && (
					<div
						data-testid={testId ? `${testId}-subline` : undefined}
						style={{
							fontSize: "11px",
							color: sublineColor ?? "var(--vscode-descriptionForeground)",
							opacity: sublineColor ? 1 : 0.85,
							marginTop: "5px",
							lineHeight: 1.4,
						}}>
						{subline}
					</div>
				)}
			</div>
		</button>
	)
}

const Pill: React.FC<{ text: string; variant: "primary" | "soon" | "locked" }> = ({ text, variant }) => (
	<span
		style={
			variant === "locked"
				? {
						fontSize: "10px",
						fontWeight: 600,
						padding: "2px 8px",
						borderRadius: "999px",
						background: "transparent",
						color: "var(--vscode-descriptionForeground)",
						border: `1px solid ${SOON_BORDER}`,
						flexShrink: 0,
					}
				: variant === "primary"
					? {
							fontSize: "10px",
							fontWeight: 600,
							padding: "2px 7px",
							borderRadius: "999px",
							background: BRAND_CYAN_UI,
							color: "#04222b",
							letterSpacing: "0.08em",
							flexShrink: 0,
						}
					: {
							fontSize: "10px",
							fontWeight: 600,
							padding: "2px 7px",
							borderRadius: "999px",
							background: "color-mix(in srgb, var(--vscode-foreground) 12%, transparent)",
							color: "var(--vscode-descriptionForeground)",
							border: SOON_BORDER,
							textTransform: "uppercase",
							letterSpacing: "0.08em",
							flexShrink: 0,
						}
		}>
		{text}
	</span>
)

export default IntentCard
