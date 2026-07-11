import { anthropicCompatibleModelInfoSaneDefaults, ModelInfo } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the AnthropicCompatibleProvider component
 */
interface AnthropicCompatibleProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * Anthropic Compatible — a generic endpoint that speaks the Anthropic Messages wire format with an arbitrary
 * (non-Claude) model: GLM via api.z.ai/api/anthropic, Kimi/Moonshot, Qwen, gateways, etc. The Anthropic-wire
 * sibling of "OpenAI Compatible". For Claude itself, use "Anthropic (Claude)".
 */
export const AnthropicCompatibleProvider = ({ showModelOptions, isPopup, currentMode }: AnthropicCompatibleProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)
	const { anthropicCompatibleModelInfo } = getModeSpecificFields(apiConfiguration, currentMode)

	const updateModelInfo = (mutate: (info: ModelInfo) => ModelInfo) => {
		const base: ModelInfo = anthropicCompatibleModelInfo
			? { ...anthropicCompatibleModelInfo }
			: { ...anthropicCompatibleModelInfoSaneDefaults }
		handleModeFieldChange(
			{ plan: "planModeAnthropicCompatibleModelInfo", act: "actModeAnthropicCompatibleModelInfo" },
			mutate(base),
			currentMode,
		)
	}

	return (
		<div>
			<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
				Any endpoint that speaks the Anthropic Messages format with a non-Claude model — e.g. GLM via
				api.z.ai/api/anthropic, Kimi/Moonshot, Qwen, or a gateway. For Claude itself, use "Anthropic (Claude)".
			</p>

			<DebouncedTextField
				initialValue={apiConfiguration?.anthropicCompatibleBaseUrl || ""}
				onChange={(value) => handleFieldChange("anthropicCompatibleBaseUrl", value)}
				placeholder="e.g. https://api.z.ai/api/anthropic"
				style={{ width: "100%", marginBottom: 10 }}
				type="text">
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</DebouncedTextField>

			<ApiKeyField
				initialValue={apiConfiguration?.anthropicCompatibleApiKey || ""}
				onChange={(value) => handleFieldChange("anthropicCompatibleApiKey", value)}
				providerName="Anthropic Compatible"
			/>

			<DebouncedTextField
				initialValue={selectedModelId || ""}
				onChange={(value) =>
					handleModeFieldChange(
						{ plan: "planModeAnthropicCompatibleModelId", act: "actModeAnthropicCompatibleModelId" },
						value,
						currentMode,
					)
				}
				placeholder="Enter Model ID... (e.g. glm-4.6)"
				style={{ width: "100%", marginBottom: 10 }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

			<div
				onClick={() => setModelConfigurationSelected((v) => !v)}
				style={{
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}>
				<span
					className={`codicon ${modelConfigurationSelected ? "codicon-chevron-down" : "codicon-chevron-right"}`}
					style={{ marginRight: "4px" }}></span>
				<span style={{ fontWeight: 700, textTransform: "uppercase" }}>Model Configuration</span>
			</div>

			{modelConfigurationSelected && (
				<>
					<VSCodeCheckbox
						checked={!!anthropicCompatibleModelInfo?.supportsImages}
						onChange={(e: any) =>
							updateModelInfo((info) => ({ ...info, supportsImages: e.target.checked === true }))
						}>
						Supports Images
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={!!anthropicCompatibleModelInfo?.supportsPromptCache}
						onChange={(e: any) =>
							updateModelInfo((info) => ({ ...info, supportsPromptCache: e.target.checked === true }))
						}>
						Supports Prompt Cache
					</VSCodeCheckbox>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								anthropicCompatibleModelInfo?.contextWindow
									? anthropicCompatibleModelInfo.contextWindow.toString()
									: (anthropicCompatibleModelInfoSaneDefaults.contextWindow?.toString() ?? "")
							}
							onChange={(value) => updateModelInfo((info) => ({ ...info, contextWindow: Number(value) }))}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								anthropicCompatibleModelInfo?.maxTokens
									? anthropicCompatibleModelInfo.maxTokens.toString()
									: (anthropicCompatibleModelInfoSaneDefaults.maxTokens?.toString() ?? "")
							}
							onChange={(value) => updateModelInfo((info) => ({ ...info, maxTokens: Number(value) }))}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>
					</div>
				</>
			)}

			{showModelOptions && (
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
