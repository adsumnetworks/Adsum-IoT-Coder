/**
 * Adsum IoT Coder - Mode Selector
 *
 * Renders two mode buttons for the user to choose between:
 * 1. Debug Live Device Logs (📊)
 * 2. Generate Logging Code (🔧)
 *
 * Used in two contexts:
 * - "welcome" variant: full-page selector shown on new task
 * - "inline" variant: compact selector shown after task completion within chat
 */

import React from "react"
import { adsumLogoDark, adsumLogoLight } from "@/assets/adsumLogoBase64"
import HistoryPreview from "@/components/history/HistoryPreview"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useVSCodeTheme } from "@/hooks/useVSCodeTheme"
import { ACTIVE_MODES, MODE_ICONS, type NordicModeId } from "./nordicModes"

interface ModeSelectorProps {
	onModeSelect: (mode: NordicModeId) => void
	disabled?: boolean
	variant?: "welcome" | "inline"
}

const ModeSelector: React.FC<ModeSelectorProps> = ({ onModeSelect, disabled = false, variant = "welcome" }) => {
	const modes = ACTIVE_MODES
	const { isDark } = useVSCodeTheme()
	const { navigateToHistory } = useExtensionState()
	const iconFilter = isDark ? "brightness(0) invert(1)" : "brightness(0)"

	const isWelcome = variant === "welcome"

	return (
		<div
			className={`flex flex-col ${isWelcome ? "items-center flex-1 px-5 pt-6 pb-4" : "gap-3 px-4 py-3"}`}
			data-testid="mode-selector">
			{/* Logo — top center */}
			{isWelcome && (
				<div className="flex justify-center w-full py-4">
					<img
						alt="Adsum IoT Coder"
						src={isDark ? adsumLogoDark : adsumLogoLight}
						style={{ maxWidth: "180px", width: "100%" }}
					/>
				</div>
			)}

			{/* Content — center center (flex-1 fills remaining height, justify-center vertically centers) */}
			<div className={`flex flex-col items-center gap-4 w-full ${isWelcome ? "flex-1 justify-center max-w-md" : ""}`}>
				{isWelcome && (
					<p
						className="text-2xl font-bold text-center w-full mb-8"
						style={{ color: "var(--vscode-foreground)", lineHeight: "1.4" }}>
						What would you like to do?
					</p>
				)}

				{!isWelcome && (
					<p className="text-sm font-medium" style={{ color: "var(--vscode-descriptionForeground)" }}>
						What would you like to do next?
					</p>
				)}

				<div className="flex flex-col gap-4 w-full">
					{modes.map((mode, idx) => (
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
								e.currentTarget.style.borderColor =
									idx === 0 ? "rgba(215, 105, 71, 0.75)" : "rgba(215, 105, 71, 0.45)"
								e.currentTarget.style.background =
									idx === 0
										? "color-mix(in srgb, #d76947 5%, var(--vscode-input-background))"
										: "var(--vscode-input-background)"
								e.currentTarget.style.transform = "none"
								e.currentTarget.style.boxShadow = "none"
							}}
							style={{
								padding: isWelcome ? "16px 20px" : "12px 16px",
								background:
									idx === 0
										? "color-mix(in srgb, #d76947 5%, var(--vscode-input-background))"
										: "var(--vscode-input-background)",
								border: `2px solid ${idx === 0 ? "rgba(215, 105, 71, 0.75)" : "rgba(215, 105, 71, 0.45)"}`,
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

				{isWelcome && (
					<div className="w-full mt-8">
						<HistoryPreview showHistoryView={navigateToHistory} />
					</div>
				)}
			</div>
		</div>
	)
}

export default ModeSelector
