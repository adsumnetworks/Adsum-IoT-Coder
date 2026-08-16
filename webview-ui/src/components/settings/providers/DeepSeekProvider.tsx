import { ANTHROPIC_MIN_THINKING_BUDGET, DEEPSEEK_EFFORT_LEVELS, deepSeekModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { getThinkingControl } from "../utils/thinkingControl"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/** API values are lowercase; these are what the developer reads. */
const EFFORT_LABELS: Record<string, string> = { low: "Low", high: "High (default)", max: "Max" }

/**
 * Props for the DeepSeekProvider component
 */
interface DeepSeekProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The DeepSeek provider configuration component
 */
export const DeepSeekProvider = ({ showModelOptions, isPopup, currentMode }: DeepSeekProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// DeepSeek V4 controls thinking via thinking.type (enabled/disabled), not a token budget — the same shape
	// as GLM — so thinkingBudgetTokens is reused purely as an on/off signal (>0 = on), matching DeepSeekHandler.
	const { thinkingBudgetTokens, reasoningEffort } = getModeSpecificFields(apiConfiguration, currentMode)
	const thinkingControl = getThinkingControl("deepseek", selectedModelId, selectedModelInfo)
	const thinkingEnabled = (thinkingBudgetTokens ?? ANTHROPIC_MIN_THINKING_BUDGET) > 0

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.deepSeekApiKey || ""}
				onChange={(value) => handleFieldChange("deepSeekApiKey", value)}
				providerName="DeepSeek"
				signupUrl="https://www.deepseek.com/"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={deepSeekModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					{/* Without this control the handler never sends `thinking` at all — it only sends the parameter
					    when the developer has set an explicit on/off — so the model's own server-side default won
					    every time and there was no way to change it from here. */}
					{thinkingControl === "onoff" && (
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
							<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
								Turn it off for faster, cheaper replies on routine steps — a build, a flash, a log capture — and
								on for diagnosing a fault or planning a change. Reasoning is billed as output tokens, so it costs
								on every turn it runs.
							</p>

							{/* Depth only means anything with thinking on, so the control only exists there. */}
							{thinkingEnabled && (
								<div style={{ marginTop: 8 }}>
									<label htmlFor="deepseek-effort-dropdown">
										<span style={{ fontWeight: 500 }}>Thinking effort</span>
									</label>
									<VSCodeDropdown
										currentValue={reasoningEffort ?? "high"}
										id="deepseek-effort-dropdown"
										onChange={(e: any) =>
											handleModeFieldChange(
												{ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" },
												e.target.value,
												currentMode,
											)
										}
										style={{ width: "100%", marginTop: 3 }}>
										{DEEPSEEK_EFFORT_LEVELS.map((level) => (
											<VSCodeOption key={level} value={level}>
												{EFFORT_LABELS[level]}
											</VSCodeOption>
										))}
									</VSCodeDropdown>
									<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
										DeepSeek's own default is <strong>High</strong>. Low suits routine agent steps; Max is for
										hard reasoning and costs the most in both tokens and latency.
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
