import { ANTHROPIC_MIN_THINKING_BUDGET, anthropicModels, CLAUDE_DEFAULT_EFFORT, CLAUDE_EFFORT_LEVELS } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DROPDOWN_Z_INDEX } from "../ApiOptions"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer, ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { getThinkingControl } from "../utils/thinkingControl"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

// Anthropic models that support thinking/reasoning mode (adaptive OR budget). Kept for the Claude Code panel and the
// chat model picker, which only need to know "does this model reason". AnthropicProvider itself uses getThinkingControl
// to render the correct control (effort vs budget) per model.
export const SUPPORTED_ANTHROPIC_THINKING_MODELS = ["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-5", "claude-haiku-4-5"]

/**
 * Props for the AnthropicProvider component
 */
interface AnthropicProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Anthropic (Claude) provider configuration component.
 * Thinking control is capability-driven: adaptive-API models (Opus 4.8/4.7, Sonnet 5) show an on/off toggle + an
 * effort level (output_config.effort); older models (Haiku 4.5) show the token-budget slider. See getThinkingControl.
 */
export const AnthropicProvider = ({ showModelOptions, isPopup, currentMode }: AnthropicProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const { thinkingBudgetTokens, reasoningEffort } = getModeSpecificFields(apiConfiguration, currentMode)

	const thinkingControl = getThinkingControl("anthropic", selectedModelId, selectedModelInfo)
	// Adaptive-API models use thinkingBudgetTokens purely as an on/off signal — the handler sends adaptive thinking +
	// output_config.effort and ignores the budget value. >0 = on.
	const thinkingEnabled = (thinkingBudgetTokens ?? 0) > 0

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.apiKey || ""}
				onChange={(value) => handleFieldChange("apiKey", value)}
				providerName="Anthropic"
				signupUrl="https://console.anthropic.com/settings/keys"
			/>

			<BaseUrlField
				initialValue={apiConfiguration?.anthropicBaseUrl}
				label="Use custom base URL"
				onChange={(value) => handleFieldChange("anthropicBaseUrl", value)}
				placeholder="Default: https://api.anthropic.com"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={anthropicModels}
						onChange={(e) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{/* Older Claude (Haiku 4.5): token-budget slider (0 = off). */}
					{thinkingControl === "budget" && (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					)}

					{/* Adaptive Claude (Opus 4.8/4.7, Sonnet 5): on/off + effort level. */}
					{thinkingControl === "effort" && (
						<div style={{ marginTop: 6 }}>
							<VSCodeCheckbox
								checked={thinkingEnabled}
								onChange={(e: any) =>
									handleModeFieldChange(
										{ plan: "planModeThinkingBudgetTokens", act: "actModeThinkingBudgetTokens" },
										e.target.checked === true ? ANTHROPIC_MIN_THINKING_BUDGET : 0,
										currentMode,
									)
								}>
								Enable extended thinking
							</VSCodeCheckbox>

							{thinkingEnabled && (
								<div style={{ marginTop: 6 }}>
									<label htmlFor="claude-effort-dropdown">
										<span>Thinking effort</span>
									</label>
									<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 100}>
										<VSCodeDropdown
											id="claude-effort-dropdown"
											onChange={(e: any) =>
												handleModeFieldChange(
													{ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" },
													e.target.value,
													currentMode,
												)
											}
											style={{ width: "100%", marginTop: 3 }}
											value={reasoningEffort || CLAUDE_DEFAULT_EFFORT}>
											{CLAUDE_EFFORT_LEVELS.map((level) => (
												<VSCodeOption key={level} value={level}>
													{level}
												</VSCodeOption>
											))}
										</VSCodeDropdown>
									</DropdownContainer>
									<p
										style={{
											fontSize: "12px",
											marginTop: 3,
											marginBottom: 0,
											color: "var(--vscode-descriptionForeground)",
										}}>
										Adaptive thinking — Claude decides depth. Higher effort explores more but takes longer and
										uses more tokens; "medium" is a good default.
									</p>
								</div>
							)}
						</div>
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
