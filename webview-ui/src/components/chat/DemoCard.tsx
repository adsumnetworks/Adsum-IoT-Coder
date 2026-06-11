import React from "react"
import { BRAND_CYAN_600, BRAND_CYAN_700, brandAlpha, brandSubtle } from "./brandColors"
import { DEFAULT_DEMO_SCENARIO_ID, DEMO_SCENARIOS } from "./demoScenarios"

interface DemoCardProps {
	onStartDemo: (scenarioId: string) => void
	disabled?: boolean
	variant?: "hero" | "rerun"
}

// Neutral surfaces for the demoted "rerun" card — quiet, no brand fill (the demo is no longer the hero).
const NEUTRAL_BORDER = "color-mix(in srgb, var(--vscode-foreground) 18%, transparent)"
const NEUTRAL_BORDER_HOVER = "color-mix(in srgb, var(--vscode-foreground) 32%, transparent)"
const NEUTRAL_ICON_BG = "color-mix(in srgb, var(--vscode-foreground) 10%, transparent)"

const DemoCard: React.FC<DemoCardProps> = ({ onStartDemo, disabled = false, variant = "hero" }) => {
	const scenario = DEMO_SCENARIOS[DEFAULT_DEMO_SCENARIO_ID]
	const isRerun = variant === "rerun"

	// Hero = cyan, prominent, full copy. Rerun = neutral, compact, title only.
	const borderColor = isRerun ? NEUTRAL_BORDER : BRAND_CYAN_600
	const borderHover = isRerun ? NEUTRAL_BORDER_HOVER : BRAND_CYAN_600
	const bgColor = isRerun ? "var(--vscode-input-background)" : brandSubtle(BRAND_CYAN_600, 5)
	const bgHover = isRerun ? "var(--vscode-toolbar-hoverBackground)" : brandSubtle(BRAND_CYAN_600, 10)
	const iconBg = isRerun ? NEUTRAL_ICON_BG : BRAND_CYAN_700
	const iconColor = isRerun ? "var(--vscode-descriptionForeground)" : "#fff"
	const iconSize = isRerun ? "14px" : "18px"
	const iconContainerSize = isRerun ? "28px" : "40px"

	return (
		<div style={{ width: "100%", marginBottom: isRerun ? 0 : "16px" }}>
			<button
				data-testid="demo-card-button"
				disabled={disabled}
				onClick={() => onStartDemo(DEFAULT_DEMO_SCENARIO_ID)}
				onMouseEnter={(e) => {
					if (!disabled) {
						e.currentTarget.style.borderColor = borderHover
						e.currentTarget.style.background = bgHover
						if (!isRerun) {
							e.currentTarget.style.transform = "translateY(-2px)"
							e.currentTarget.style.boxShadow = `0 6px 20px ${brandAlpha(BRAND_CYAN_600, 0.2)}`
						}
					}
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.borderColor = borderColor
					e.currentTarget.style.background = bgColor
					e.currentTarget.style.transform = "none"
					e.currentTarget.style.boxShadow = "none"
				}}
				style={{
					width: "100%",
					padding: isRerun ? "10px 14px" : "18px 20px",
					background: bgColor,
					border: `${isRerun ? "1px" : "2px"} solid ${borderColor}`,
					borderRadius: isRerun ? "8px" : "10px",
					cursor: disabled ? "default" : "pointer",
					opacity: disabled ? 0.5 : 1,
					textAlign: "left",
					transition: "transform 0.15s, box-shadow 0.15s, background 0.15s, border-color 0.15s",
				}}
				type="button">
				<div style={{ display: "flex", alignItems: "center", gap: isRerun ? "10px" : "14px" }}>
					<div
						style={{
							flexShrink: 0,
							width: iconContainerSize,
							height: iconContainerSize,
							borderRadius: "50%",
							background: iconBg,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: iconColor,
						}}>
						<i className={`codicon codicon-${isRerun ? "refresh" : "rocket"}`} style={{ fontSize: iconSize }} />
					</div>

					{isRerun ? (
						<div
							style={{
								fontSize: "13px",
								fontWeight: 600,
								color: "var(--vscode-foreground)",
								lineHeight: "1.3",
							}}>
							Re-run demo
						</div>
					) : (
						<div style={{ flex: 1 }}>
							<div
								style={{
									fontSize: "16px",
									fontWeight: 700,
									color: "var(--vscode-foreground)",
									marginBottom: "4px",
									lineHeight: "1.3",
								}}>
								See it debug a real bug
							</div>
							<div
								style={{
									fontSize: "13px",
									color: "var(--vscode-descriptionForeground)",
									marginBottom: "8px",
								}}>
								{scenario.title} — no setup, no hardware needed
							</div>
							<div
								style={{
									fontSize: "11px",
									color: "var(--vscode-descriptionForeground)",
									opacity: 0.7,
									fontStyle: "italic",
								}}>
								{scenario.honestLabel}
							</div>
						</div>
					)}
				</div>
			</button>
		</div>
	)
}

export default DemoCard
