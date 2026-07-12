import { ApiProvider, CLAUDE_ADAPTIVE_API_MODELS, ModelInfo } from "@shared/api"

/**
 * The kind of thinking/reasoning control a model's API supports. This drives which UI control a provider panel
 * renders, so we never show a control that doesn't apply — or send a param the model rejects with a 400:
 *   - "effort": adaptive-API Claude (Opus 4.8/4.7, Sonnet 5) — on/off + effort level (output_config.effort)
 *   - "budget": older Claude (Haiku 4.5, ≤4.6) — on/off via a token budget (thinking.budget_tokens)
 *   - "onoff":  everything else that reasons (GLM thinking.type, Anthropic-compatible, …) — plain on/off
 *   - "none":   the model doesn't reason — hide the thinking control entirely
 */
export type ThinkingControl = "effort" | "budget" | "onoff" | "none"

export function getThinkingControl(provider: ApiProvider | undefined, modelId: string, modelInfo?: ModelInfo): ThinkingControl {
	if (!(modelInfo?.supportsReasoning ?? false)) {
		return "none"
	}
	// Claude splits by API generation: current-gen models tune depth with an effort level; older ones use a token budget.
	if (provider === "anthropic" || provider === "claude-code") {
		return CLAUDE_ADAPTIVE_API_MODELS.has(modelId) ? "effort" : "budget"
	}
	return "onoff"
}
