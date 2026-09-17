import { isAdsumOwnProvider, isGPT5ModelFamily, isNextGenModelFamily, isNextGenModelProvider } from "@utils/model-utils"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { TEMPLATE_OVERRIDES } from "./template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.NATIVE_NEXT_GEN)
	.description("Next gen models with native tool calling")
	.version(1)
	.tags("advanced", "production", "native_tools")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
		use_native_tools: 1,
	})
	.matcher((context) => {
		if (!context.enableNativeToolCalls) {
			return false
		}
		const providerInfo = context.providerInfo
		if (!isNextGenModelProvider(providerInfo)) {
			return false
		}
		const modelId = providerInfo.model.id.toLowerCase()
		if (isGPT5ModelFamily(modelId)) {
			// GPT-5 has variants of its own; this one must not take them.
			return false
		}
		/*
		 * Capability, decided the way isNativeToolCallingConfig already decides it: a declared
		 * answer first, our own provider second, the name only as a fallback.
		 *
		 * A name test alone cannot work for the free tier. Its id is "free-default" — opaque on
		 * purpose, so the forwarder can change what it serves without the client knowing — so it
		 * matches no family, falls through to the generic XML variant, and is asked for tool calls
		 * in XML. The model behind it calls tools NATIVELY, so it answers in its own markup, which
		 * spills into the text channel half-detokenised:
		 *
		 *     <｜｜DSML｜｜ invoke name="read_file"> /path/to/file </｜｜DSML｜｜ invoke
		 *
		 * The parameter OPENERS are missing, so no parser recovers it, and the host reports
		 * "without value for required parameter 'path'". The model then shrinks its own output and
		 * retries, five times, and the session dies. Measured against the vendor the same day: ask
		 * in XML and it leaks; send a tools array and it returns finish_reason: tool_calls, one
		 * clean call, no markup anywhere.
		 *
		 * Deliberately NOT calling isNativeToolCallingConfig outright, tidy as that would be: it
		 * carries ENABLE_GLM_NATIVE_TOOL_CALLS = false and reusing it would move GLM off its own
		 * variant — a real behaviour change to a shipped provider. This widens to a declared
		 * capability and to our own provider, and to nothing else.
		 */
		const declared = providerInfo.model.info?.supportsNativeTools
		if (typeof declared === "boolean") {
			return declared
		}
		if (isAdsumOwnProvider(providerInfo)) {
			return true
		}
		return isNextGenModelFamily(modelId)
	})
	.template(TEMPLATE_OVERRIDES.BASE)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TODO,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.FEEDBACK,
		SystemPromptSection.RULES,
		SystemPromptSection.MCP,
		SystemPromptSection.IOT_CONTEXT,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
		SystemPromptSection.SKILLS,
	)
	.tools(
		ClineDefaultTool.ASK,
		ClineDefaultTool.BASH,
		ClineDefaultTool.FILE_READ,
		ClineDefaultTool.FILE_NEW,
		ClineDefaultTool.FILE_EDIT,
		ClineDefaultTool.SEARCH,
		ClineDefaultTool.LIST_FILES,
		ClineDefaultTool.LIST_CODE_DEF,
		ClineDefaultTool.BROWSER,
		ClineDefaultTool.WEB_FETCH,
		ClineDefaultTool.WEB_SEARCH,
		ClineDefaultTool.MCP_USE,
		ClineDefaultTool.MCP_ACCESS,
		ClineDefaultTool.ATTEMPT,
		ClineDefaultTool.PLAN_MODE,
		ClineDefaultTool.MCP_DOCS,
		ClineDefaultTool.TODO,
		ClineDefaultTool.GENERATE_EXPLANATION,
		ClineDefaultTool.USE_SKILL,
		ClineDefaultTool.NORDIC_ACTION,
		ClineDefaultTool.ESP_ACTION,
		ClineDefaultTool.CVE_SCAN,
		ClineDefaultTool.UPDATE_MEMORY,
	)
	.placeholders({
		MODEL_FAMILY: ModelFamily.NATIVE_NEXT_GEN,
	})
	.config({})
	// Override the RULES component with custom template
	.overrideComponent(SystemPromptSection.RULES, {
		template: TEMPLATE_OVERRIDES.RULES,
	})
	.overrideComponent(SystemPromptSection.TOOL_USE, {
		template: TEMPLATE_OVERRIDES.TOOL_USE,
	})
	.overrideComponent(SystemPromptSection.OBJECTIVE, {
		template: TEMPLATE_OVERRIDES.OBJECTIVE,
	})
	.overrideComponent(SystemPromptSection.ACT_VS_PLAN, {
		template: TEMPLATE_OVERRIDES.ACT_VS_PLAN,
	})
	.overrideComponent(SystemPromptSection.FEEDBACK, {
		template: TEMPLATE_OVERRIDES.FEEDBACK,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: ModelFamily.NATIVE_NEXT_GEN }, { strict: true })
if (!validationResult.isValid) {
	console.error("Native Next Gen variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid Native Next Gen variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	console.warn("Native Next Gen variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type NativeNextGenVariantConfig = typeof config
