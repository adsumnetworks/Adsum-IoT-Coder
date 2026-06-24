import React from "react"
import { BRAND_CYAN_600, BRAND_CYAN_700, brandSubtle } from "../brandColors"
import { DEMO_SCENARIO_LIST } from "../demoScenarios"

interface DemoPickerProps {
	onStartDemo: (scenarioId: string) => void
	disabled?: boolean
	variant?: "hero" | "rerun"
}

// Neutral surfaces for the demoted "rerun" state — quiet, no brand fill (the samples are no longer the hero).
const NEUTRAL_BORDER = "color-mix(in srgb, var(--vscode-foreground) 18%, transparent)"
const NEUTRAL_BORDER_HOVER = "color-mix(in srgb, var(--vscode-foreground) 32%, transparent)"
const NEUTRAL_ICON_BG = "color-mix(in srgb, var(--vscode-foreground) 10%, transparent)"

/**
 * "Try it on a sample" — the consolidated sample picker. Renders one row per registered demo scenario
 * (BLE bug, CRA readiness, …). Replaces the single-scenario DemoCard once the registry holds ≥2 scenarios.
 *
 * - hero: cyan container, the single first-run focal point (until the user has run any sample once).
 * - rerun: neutral, compact — quiet "Try another sample" once a sample has been seen.
 *
 * Rows are domain-agnostic: they read title / honestLabel / platform / icon straight off each scenario,
 * so adding a sample to DEMO_SCENARIOS surfaces it here with no change to this component.
 */
const DemoPicker: React.FC<DemoPickerProps> = ({ onStartDemo, disabled = false, variant = "hero" }) => {
	const isRerun = variant === "rerun"
	const containerBorder = isRerun ? NEUTRAL_BORDER : BRAND_CYAN_600
	const containerBg = isRerun ? "transparent" : brandSubtle(BRAND_CYAN_600, 5)

	return (
		<div
			data-testid="demo-picker"
			style={{
				width: "100%",
				marginBottom: isRerun ? 0 : "16px",
				padding: isRerun ? "12px 14px" : "16px 18px",
				background: containerBg,
				border: `${isRerun ? "1px" : "2px"} solid ${containerBorder}`,
				borderRadius: "10px",
			}}>
			<div
				style={{
					fontSize: isRerun ? "12px" : "15px",
					fontWeight: 700,
					color: "var(--vscode-foreground)",
					marginBottom: isRerun ? "8px" : "3px",
				}}>
				{isRerun ? "Try another sample" : "Try it on a sample"}
			</div>
			{!isRerun && (
				<div
					style={{
						fontSize: "11.5px",
						color: "var(--vscode-descriptionForeground)",
						marginBottom: "12px",
					}}>
					Real firmware, real logs — no board, no setup.
				</div>
			)}

			<div style={{ display: "flex", flexDirection: "column", gap: isRerun ? "6px" : "8px" }}>
				{DEMO_SCENARIO_LIST.map((s) => (
					<button
						data-testid={`demo-scenario-${s.id}`}
						disabled={disabled}
						key={s.id}
						onClick={() => onStartDemo(s.id)}
						onMouseEnter={(e) => {
							if (!disabled) {
								e.currentTarget.style.borderColor = NEUTRAL_BORDER_HOVER
								e.currentTarget.style.background = "var(--vscode-toolbar-hoverBackground)"
							}
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.borderColor = NEUTRAL_BORDER
							e.currentTarget.style.background = "var(--vscode-input-background)"
						}}
						style={{
							width: "100%",
							display: "flex",
							alignItems: "center",
							gap: "12px",
							padding: isRerun ? "8px 10px" : "10px 12px",
							background: "var(--vscode-input-background)",
							border: `1px solid ${NEUTRAL_BORDER}`,
							borderRadius: "8px",
							cursor: disabled ? "default" : "pointer",
							opacity: disabled ? 0.5 : 1,
							textAlign: "left",
							transition: "background 0.15s, border-color 0.15s",
						}}
						type="button">
						<div
							style={{
								flexShrink: 0,
								width: isRerun ? "26px" : "32px",
								height: isRerun ? "26px" : "32px",
								borderRadius: "50%",
								background: isRerun ? NEUTRAL_ICON_BG : BRAND_CYAN_700,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								color: isRerun ? "var(--vscode-descriptionForeground)" : "#fff",
							}}>
							<i className={`codicon codicon-${s.icon}`} style={{ fontSize: isRerun ? "13px" : "15px" }} />
						</div>

						<div style={{ flex: 1, minWidth: 0 }}>
							<div
								style={{
									fontSize: isRerun ? "12.5px" : "13.5px",
									fontWeight: 600,
									color: "var(--vscode-foreground)",
									lineHeight: 1.3,
								}}>
								{s.title}
							</div>
							{!isRerun && (
								<div
									style={{
										fontSize: "11px",
										color: "var(--vscode-descriptionForeground)",
										opacity: 0.8,
										marginTop: "2px",
										lineHeight: 1.35,
									}}>
									{s.honestLabel}
								</div>
							)}
						</div>

						<span
							style={{
								flexShrink: 0,
								fontSize: "9.5px",
								fontWeight: 700,
								letterSpacing: "0.04em",
								textTransform: "uppercase",
								color: "var(--vscode-descriptionForeground)",
								border: `1px solid ${NEUTRAL_BORDER}`,
								borderRadius: "4px",
								padding: "1px 5px",
							}}>
							{s.platform}
						</span>
					</button>
				))}
			</div>
		</div>
	)
}

export default DemoPicker
