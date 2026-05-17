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
import { aiGeneratedCodeIcon, analyseBugsIcon } from "@/assets/modeIconsBase64"
import NrfLogo from "@/assets/NrfLogo"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import { NORDIC_MODES, type NordicModeId } from "./nordicModes"

const MODE_ICONS: Record<NordicModeId, string> = {
	log_generator: aiGeneratedCodeIcon,
	log_analyzer: analyseBugsIcon,
}

interface ModeSelectorProps {
	onModeSelect: (mode: NordicModeId) => void
	disabled?: boolean
	variant?: "welcome" | "inline"
}

const ModeSelector: React.FC<ModeSelectorProps> = ({ onModeSelect, disabled = false, variant = "welcome" }) => {
	const modes = Object.values(NORDIC_MODES)
	const { isDark } = useVSCodeTheme()
	const iconFilter = isDark ? "brightness(0) invert(1)" : "brightness(0)"

	const isWelcome = variant === "welcome"

	return (
		<div
			className={`flex flex-col gap-3 ${isWelcome ? "items-center flex-1 px-5 pt-8 pb-4" : "px-4 py-3"}`}
			data-testid="mode-selector">
			{isWelcome && (
				<div className="text-center mb-4 w-full">
					<div className="flex justify-center mb-4">
						<NrfLogo className="size-24" />
					</div>
					<p
						className="text-2xl font-bold mb-4"
						style={{ textAlign: "center", width: "100%", color: "var(--vscode-foreground)", lineHeight: "1.4" }}>
						What would you like to do?
					</p>
				</div>
			)}

			{!isWelcome && (
				<p className="text-sm font-medium" style={{ color: "var(--vscode-descriptionForeground)" }}>
					What would you like to do next?
				</p>
			)}

			<div className={`flex flex-col gap-3 w-full ${isWelcome ? "max-w-md" : ""}`}>
				{modes.map((mode) => (
					<button
						className="flex items-center rounded-lg cursor-pointer transition-all duration-200 w-full"
						data-testid={`mode-button-${mode.id}`}
						disabled={disabled}
						key={mode.id}
						onClick={() => onModeSelect(mode.id)}
						onMouseEnter={(e) => {
							if (!disabled) {
								e.currentTarget.style.borderColor = "#00a9ce"
								e.currentTarget.style.background =
									"color-mix(in srgb, #00a9ce 8%, var(--vscode-input-background))"
								e.currentTarget.style.transform = "translateY(-2px)"
								e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 169, 206, 0.15)"
							}
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.borderColor = "rgba(215, 105, 71, 0.45)"
							e.currentTarget.style.background = "var(--vscode-input-background)"
							e.currentTarget.style.transform = "none"
							e.currentTarget.style.boxShadow = "none"
						}}
						style={{
							padding: isWelcome ? "16px 20px" : "12px 16px",
							background: "var(--vscode-input-background)",
							border: "2px solid rgba(215, 105, 71, 0.45)",
							opacity: disabled ? 0.5 : 1,
							pointerEvents: disabled ? "none" : "auto",
							textAlign: "left",
						}}
						type="button">
						<img
							alt={mode.title}
							className="flex-shrink-0 object-contain"
							src={MODE_ICONS[mode.id]}
							style={{
								width: isWelcome ? "40px" : "28px",
								height: isWelcome ? "40px" : "28px",
								marginRight: isWelcome ? "16px" : "12px",
								filter: iconFilter,
							}}
						/>
						<div className="flex flex-col items-start flex-1">
							<span
								className="font-semibold"
								style={{
									fontSize: isWelcome ? "16px" : "14px",
									color: "var(--vscode-foreground)",
									marginBottom: "2px",
								}}>
								{mode.title}
							</span>
							<span className="text-sm" style={{ color: "var(--vscode-descriptionForeground)" }}>
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
