import type { ApiStreamUsageChunk } from "./stream"

/**
 * OpenAI-compatible usage shape (the fields we consume). Per the OpenAI contract,
 * `prompt_tokens` is the TOTAL prompt — it already INCLUDES
 * `prompt_tokens_details.cached_tokens`. Some providers (DeepSeek) instead report
 * the split as prompt_cache_hit_tokens / prompt_cache_miss_tokens, where the two
 * halves sum to prompt_tokens.
 */
export interface OpenAiCompatibleUsage {
	prompt_tokens?: number
	completion_tokens?: number
	prompt_tokens_details?: { cached_tokens?: number }
	prompt_cache_hit_tokens?: number
	prompt_cache_miss_tokens?: number
}

/**
 * Split an OpenAI-compatible usage record into disjoint buckets so that
 * inputTokens + cacheReadTokens + cacheWriteTokens === prompt_tokens.
 *
 * The context gauge (ContextManager / ContextBudget / the UI meter) SUMS all
 * buckets — reporting the total in inputTokens AND the cached share again in
 * cacheReadTokens double-counts every cached token (~1.9× inflation measured on
 * real zai-coding-plan sessions), which fires compaction at roughly half the
 * real window. Cost math should keep using the raw totals, not this split.
 */
export function splitOpenAiUsage(usage: OpenAiCompatibleUsage): ApiStreamUsageChunk {
	const promptTokens = usage.prompt_tokens || 0
	const outputTokens = usage.completion_tokens || 0
	const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0
	const cacheWriteTokens = usage.prompt_cache_miss_tokens || 0
	return {
		type: "usage",
		inputTokens: Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens),
		outputTokens,
		cacheReadTokens,
		cacheWriteTokens,
	}
}
