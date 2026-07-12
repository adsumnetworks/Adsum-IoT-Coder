import { ANTHROPIC_MIN_THINKING_BUDGET, zaiCodingPlanModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the GlmCodingPlanProvider component
 */
interface GlmCodingPlanProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * GLM Coding Plan — the flat z.ai subscription, as a first-class provider.
 * OpenAI-compatible coding endpoint (api.z.ai/api/coding/paas/v4, forced in the handler); international only for v1.
 * Reuses the Z.AI API-key secret (both are z.ai keys).
 */
export const GlmCodingPlanProvider = ({ showModelOptions, isPopup, currentMode }: GlmCodingPlanProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const { thinkingBudgetTokens } = getModeSpecificFields(apiConfiguration, currentMode)
	// GLM controls thinking via thinking.type (on/off), not a token budget — so we reuse thinkingBudgetTokens purely as
	// the on/off signal: >0 (or unset → the model's own default) = on, 0 = off. The zai handler maps this to thinking.type.
	const thinkingEnabled = (thinkingBudgetTokens ?? ANTHROPIC_MIN_THINKING_BUDGET) > 0

	return (
		<div>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Your flat GLM Coding Plan subscription (z.ai). Paste the coding-plan API key below — the coding endpoint
				(api.z.ai/api/coding/paas/v4) and model list are set automatically.
			</p>
			<ApiKeyField
				initialValue={apiConfiguration?.zaiApiKey || ""}
				onChange={(value) => handleFieldChange("zaiApiKey", value)}
				providerName="GLM Coding Plan"
				signupUrl="https://z.ai/subscribe"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={zaiCodingPlanModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

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
							GLM decides how deeply to reason. Turn this off for faster, cheaper replies — thinking runs ~15–20
							model calls per prompt, so disabling it also stretches your plan's prompt quota.
						</p>
					</div>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
