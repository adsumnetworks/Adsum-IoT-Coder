import { ModelInfo, PRICING_SCHEDULES } from "@shared/api"

/**
 * The multiplier a vendor's clock-based discount puts on every price right now.
 *
 * [OPERATOR 2026-09-04] DeepSeek charges full rate only 01:00–04:00 and 06:00–10:00 UTC on
 * weekdays and half rate the other 79% of the week, so a cost computed from the list rate alone
 * is roughly double the truth most of the time. The windows are published and deterministic, so
 * this needs no network — unlike the list rates themselves, which are fetched (see
 * refreshDirectModelPrices).
 *
 * Exported so a test can pin a moment; `at` defaults to now.
 */
export function pricingMultiplier(modelId: string | undefined, at: Date = new Date()): number {
	const schedule = modelId ? PRICING_SCHEDULES[modelId] : undefined
	if (!schedule) {
		return 1
	}
	const isPeakDay = schedule.peakDays.includes(at.getUTCDay())
	const hour = at.getUTCHours()
	const inPeakHour = schedule.peakUtcHours.some(([from, to]) => hour >= from && hour < to)
	return isPeakDay && inPeakHour ? 1 : schedule.offPeakMultiplier
}

function calculateApiCostInternal(
	modelInfo: ModelInfo,
	inputTokens: number, // Note: For OpenAI-style, this is non-cached tokens. For Anthropic-style, this is total input tokens.
	outputTokens: number,
	cacheCreationInputTokens: number,
	cacheReadInputTokens: number,
	totalInputTokensForPricing?: number, // The *total* input tokens, used for tiered pricing lookup
	thinkingBudgetTokens?: number, // Add thinking budget info
	modelId?: string, // For clock-based vendor discounts — see pricingMultiplier
): number {
	const usedThinkingBudget = thinkingBudgetTokens && thinkingBudgetTokens > 0

	// Default prices
	let effectiveInputPrice = modelInfo.inputPrice || 0
	let effectiveOutputPrice = modelInfo.outputPrice || 0
	let effectiveCacheReadsPrice = modelInfo.cacheReadsPrice || 0
	let effectiveCacheWritesPrice = modelInfo.cacheWritesPrice || 0

	// Handle tiered pricing if available
	if (modelInfo.tiers && modelInfo.tiers.length > 0 && totalInputTokensForPricing !== undefined) {
		// Ensure tiers are sorted by contextWindow ascending before finding
		const sortedTiers = [...modelInfo.tiers].sort((a, b) => a.contextWindow - b.contextWindow)

		// Find the first tier where the total input tokens are less than or equal to the limit
		const tier = sortedTiers.find((t) => totalInputTokensForPricing <= t.contextWindow)

		if (tier) {
			// Apply all tiered price values if they exist
			effectiveInputPrice = tier.inputPrice ?? effectiveInputPrice
			effectiveOutputPrice = tier.outputPrice ?? effectiveOutputPrice
			effectiveCacheReadsPrice = tier.cacheReadsPrice ?? effectiveCacheReadsPrice
			effectiveCacheWritesPrice = tier.cacheWritesPrice ?? effectiveCacheWritesPrice
		} else {
			// Should ideally not happen if Infinity is used for the last tier, but fallback just in case
			const lastTier = sortedTiers[sortedTiers.length - 1]
			if (lastTier) {
				effectiveInputPrice = lastTier.inputPrice ?? effectiveInputPrice
				effectiveOutputPrice = lastTier.outputPrice ?? effectiveOutputPrice
				effectiveCacheReadsPrice = lastTier.cacheReadsPrice ?? effectiveCacheReadsPrice
				effectiveCacheWritesPrice = lastTier.cacheWritesPrice ?? effectiveCacheWritesPrice
			}
		}
	}

	// Override output price for thinking mode if applicable
	if (usedThinkingBudget && modelInfo.thinkingConfig?.outputPrice !== undefined) {
		effectiveOutputPrice = modelInfo.thinkingConfig.outputPrice
		// TODO: Add support for tiered thinking budget output pricing if needed in the future
	}

	const cacheWritesCost = (effectiveCacheWritesPrice / 1_000_000) * cacheCreationInputTokens
	const cacheReadsCost = (effectiveCacheReadsPrice / 1_000_000) * cacheReadInputTokens

	// Use effectiveInputPrice for baseInputCost. Note: 'inputTokens' here is the potentially adjusted count (e.g., non-cached for OpenAI)
	const baseInputCost = (effectiveInputPrice / 1_000_000) * inputTokens

	// Use effectiveOutputPrice for outputCost
	const outputCost = (effectiveOutputPrice / 1_000_000) * outputTokens

	const totalCost = cacheWritesCost + cacheReadsCost + baseInputCost + outputCost
	// Applied last, to the whole bill: the vendor discounts every line by the same factor.
	return totalCost * pricingMultiplier(modelId)
}
// For Anthropic compliant usage, the input tokens count does NOT include the cached tokens
export function calculateApiCostAnthropic(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
	thinkingBudgetTokens?: number,
	modelId?: string,
): number {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Anthropic style: inputTokens already represents the total, so pass it directly for tiered pricing lookup if needed
	// (though Anthropic models currently don't use tiered pricing based on input size)
	// Anthropic style doesn't need totalInputTokensForPricing as its inputTokens already represents the total
	return calculateApiCostInternal(
		modelInfo,
		inputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens + cacheCreationInputTokensNum + cacheReadInputTokensNum, // used for tiered price lookup
		thinkingBudgetTokens,
		modelId,
	)
}

// For OpenAI compliant usage, the input tokens count INCLUDES the cached tokens
export function calculateApiCostOpenAI(
	modelInfo: ModelInfo,
	inputTokens: number, // For OpenAI-style, this includes cached tokens
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
	thinkingBudgetTokens?: number, // Pass thinking budget info
	modelId?: string,
): number {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Calculate non-cached tokens for the internal function's 'inputTokens' parameter
	const nonCachedInputTokens = Math.max(0, inputTokens - cacheCreationInputTokensNum - cacheReadInputTokensNum)
	// Pass the original 'inputTokens' as 'totalInputTokensForPricing' for tier lookup
	return calculateApiCostInternal(
		modelInfo,
		nonCachedInputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens,
		thinkingBudgetTokens,
		modelId,
	)
}

// For Qwen compliant usage, follows OpenAI-style token counting where input tokens include cached tokens
export function calculateApiCostQwen(
	modelInfo: ModelInfo,
	inputTokens: number, // For Qwen-style, this includes cached tokens
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
	thinkingBudgetTokens?: number,
	modelId?: string,
): number {
	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	// Calculate non-cached tokens for the internal function's 'inputTokens' parameter
	const nonCachedInputTokens = Math.max(0, inputTokens - cacheCreationInputTokensNum - cacheReadInputTokensNum)
	// Pass the original 'inputTokens' as 'totalInputTokensForPricing' for tier lookup
	return calculateApiCostInternal(
		modelInfo,
		nonCachedInputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens,
		thinkingBudgetTokens,
		modelId,
	)
}
