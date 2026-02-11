/**
 * Nordic Logging Assistant - Mode Selector
 *
 * Renders two mode buttons for the user to choose between:
 * 1. Generate Logging Code (🔧)
 * 2. Analyze Device Logs (📊)
 *
 * Used in two contexts:
 * - "welcome" variant: full-page selector shown on new task
 * - "inline" variant: compact selector shown after task completion within chat
 */

import React from "react"
import { NORDIC_MODES, type NordicModeId } from "./nordicModes"

interface ModeSelectorProps {
	onModeSelect: (mode: NordicModeId) => void
	disabled?: boolean
	variant?: "welcome" | "inline"
}

const ModeSelector: React.FC<ModeSelectorProps> = ({ onModeSelect, disabled = false, variant = "welcome" }) => {
	const modes = Object.values(NORDIC_MODES)

	const isWelcome = variant === "welcome"

	return (
		<div
			className={`flex flex-col gap-3 ${isWelcome ? "items-center justify-center flex-1 px-5 py-8" : "px-4 py-3"}`}
			data-testid="mode-selector">
			{isWelcome && (
				<div className="text-center mb-4">
					<h2
						className="text-lg font-semibold mb-1"
						style={{ color: "var(--vscode-foreground)" }}>
						Nordic Logging Assistant
					</h2>
					<p
						className="text-sm"
						style={{ color: "var(--vscode-descriptionForeground)" }}>
						What would you like to do?
					</p>
				</div>
			)}

			{!isWelcome && (
				<p
					className="text-sm font-medium"
					style={{ color: "var(--vscode-descriptionForeground)" }}>
					What would you like to do next?
				</p>
			)}

			<div className={`flex flex-col gap-3 w-full ${isWelcome ? "max-w-md" : ""}`}>
				{modes.map((mode) => (
					<button
						key={mode.id}
						type="button"
						data-testid={`mode-button-${mode.id}`}
						disabled={disabled}
						onClick={() => onModeSelect(mode.id)}
						className="flex items-center rounded-lg cursor-pointer transition-all duration-200"
						style={{
							padding: isWelcome ? "16px 20px" : "12px 16px",
							background: "var(--vscode-input-background)",
							border: "2px solid var(--vscode-input-border, var(--vscode-editorGroup-border))",
							opacity: disabled ? 0.5 : 1,
							pointerEvents: disabled ? "none" : "auto",
						}}
						onMouseEnter={(e) => {
							if (!disabled) {
								e.currentTarget.style.borderColor = "#00a9ce"
								e.currentTarget.style.background = "color-mix(in srgb, #00a9ce 8%, var(--vscode-input-background))"
								e.currentTarget.style.transform = "translateY(-2px)"
								e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 169, 206, 0.15)"
							}
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.borderColor = "var(--vscode-input-border, var(--vscode-editorGroup-border))"
							e.currentTarget.style.background = "var(--vscode-input-background)"
							e.currentTarget.style.transform = "none"
							e.currentTarget.style.boxShadow = "none"
						}}>
						<span
							className="flex-shrink-0"
							style={{ fontSize: isWelcome ? "32px" : "24px", marginRight: isWelcome ? "16px" : "12px" }}>
							{mode.icon}
						</span>
						<div className="flex flex-col items-start">
							<span
								className="font-semibold"
								style={{
									fontSize: isWelcome ? "16px" : "14px",
									color: "var(--vscode-foreground)",
									marginBottom: "2px",
								}}>
								{mode.title}
							</span>
							<span
								className="text-sm"
								style={{ color: "var(--vscode-descriptionForeground)" }}>
								{mode.description}
							</span>
						</div>
					</button>
				))}
			</div>
		</div>
	)
}

export default ModeSelector
