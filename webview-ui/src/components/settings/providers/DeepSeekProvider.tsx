import { ANTHROPIC_MIN_THINKING_BUDGET, deepSeekModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { getThinkingControl } from "../utils/thinkingControl"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

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
	const { thinkingBudgetTokens } = getModeSpecificFields(apiConfiguration, currentMode)
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
								DeepSeek decides how deeply to reason. Turn it off for faster, cheaper replies on routine steps —
								a build, a flash, a log capture — and on for diagnosing a fault or planning a change. Reasoning is
								billed as output tokens, so it costs on every turn it runs.
							</p>
						</div>
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
