import React from "react"
import { DEFAULT_DEMO_SCENARIO_ID, DEMO_SCENARIOS } from "./demoScenarios"

interface DemoCardProps {
	onStartDemo: (scenarioId: string) => void
	disabled?: boolean
}

const DemoCard: React.FC<DemoCardProps> = ({ onStartDemo, disabled = false }) => {
	const scenario = DEMO_SCENARIOS[DEFAULT_DEMO_SCENARIO_ID]

	return (
		<div
			style={{
				width: "100%",
				marginBottom: "16px",
			}}>
			<button
				data-testid="demo-card-button"
				disabled={disabled}
				onClick={() => onStartDemo(DEFAULT_DEMO_SCENARIO_ID)}
				onMouseEnter={(e) => {
					if (!disabled) {
						e.currentTarget.style.borderColor = "#00a9ce"
						e.currentTarget.style.background = "color-mix(in srgb, #00a9ce 10%, var(--vscode-input-background))"
						e.currentTarget.style.transform = "translateY(-2px)"
						e.currentTarget.style.boxShadow = "0 6px 20px rgba(0, 169, 206, 0.2)"
					}
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.borderColor = "#00a9ce"
					e.currentTarget.style.background = "color-mix(in srgb, #00a9ce 5%, var(--vscode-input-background))"
					e.currentTarget.style.transform = "none"
					e.currentTarget.style.boxShadow = "none"
				}}
				style={{
					width: "100%",
					padding: "18px 20px",
					background: "color-mix(in srgb, #00a9ce 5%, var(--vscode-input-background))",
					border: "2px solid #00a9ce",
					borderRadius: "10px",
					cursor: disabled ? "default" : "pointer",
					opacity: disabled ? 0.5 : 1,
					textAlign: "left",
					transition: "transform 0.15s, box-shadow 0.15s, background 0.15s",
				}}
				type="button">
				<div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
					{/* Play icon */}
					<div
						style={{
							flexShrink: 0,
							width: "40px",
							height: "40px",
							borderRadius: "50%",
							background: "#00a9ce",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: "18px",
						}}>
						▶
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
							Watch it debug a real bug
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
