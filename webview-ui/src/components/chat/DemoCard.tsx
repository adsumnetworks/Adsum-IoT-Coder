import React from "react"
import { BRAND_CYAN_600, BRAND_CYAN_700, brandAlpha, brandSubtle } from "./brandColors"
import { DEFAULT_DEMO_SCENARIO_ID, DEMO_SCENARIOS } from "./demoScenarios"

interface DemoCardProps {
	onStartDemo: (scenarioId: string) => void
	disabled?: boolean
}

const DemoCard: React.FC<DemoCardProps> = ({ onStartDemo, disabled = false }) => {
	const scenario = DEMO_SCENARIOS[DEFAULT_DEMO_SCENARIO_ID]

	return (
		<div style={{ width: "100%", marginBottom: "16px" }}>
			<button
				data-testid="demo-card-button"
				disabled={disabled}
				onClick={() => onStartDemo(DEFAULT_DEMO_SCENARIO_ID)}
				onMouseEnter={(e) => {
					if (!disabled) {
						e.currentTarget.style.borderColor = BRAND_CYAN_600
						e.currentTarget.style.background = brandSubtle(BRAND_CYAN_600, 10)
						e.currentTarget.style.transform = "translateY(-2px)"
						e.currentTarget.style.boxShadow = `0 6px 20px ${brandAlpha(BRAND_CYAN_600, 0.2)}`
					}
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.borderColor = BRAND_CYAN_600
					e.currentTarget.style.background = brandSubtle(BRAND_CYAN_600, 5)
					e.currentTarget.style.transform = "none"
					e.currentTarget.style.boxShadow = "none"
				}}
				style={{
					width: "100%",
					padding: "18px 20px",
					background: brandSubtle(BRAND_CYAN_600, 5),
					border: `2px solid ${BRAND_CYAN_600}`,
					borderRadius: "10px",
					cursor: disabled ? "default" : "pointer",
					opacity: disabled ? 0.5 : 1,
					textAlign: "left",
					transition: "transform 0.15s, box-shadow 0.15s, background 0.15s",
				}}
				type="button">
				<div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
					{/* Launch icon (▶ is reserved for recorded video) */}
					<div
						style={{
							flexShrink: 0,
							width: "40px",
							height: "40px",
							borderRadius: "50%",
							background: BRAND_CYAN_700,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "#fff",
						}}>
						<i className="codicon codicon-rocket" style={{ fontSize: "18px" }} />
					</div>

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
				</div>
			</button>
		</div>
	)
}

export default DemoCard
