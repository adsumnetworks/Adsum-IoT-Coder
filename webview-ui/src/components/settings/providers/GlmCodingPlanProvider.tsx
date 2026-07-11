import { zaiCodingPlanModels } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
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

	return (
		<div>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				Your flat GLM Coding Plan subscription (z.ai). Paste the coding-plan API key below — the coding endpoint
				(api.z.ai/api/coding/paas/v4) and model list are set automatically. Hosted by Zhipu AI (China); for regulated or
				sensitive firmware, prefer Claude or a local model instead.
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

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
