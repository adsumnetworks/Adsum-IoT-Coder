/**
 * [0.5 live usage streaming] Folds one usage chunk into a turn's running totals, so the
 * api_req_started message can be updated after every chunk instead of only once the stream
 * ends. The fold is the whole point: call it on every "usage" chunk and the developer watches
 * tokens and cost climb as the model answers, rather than seeing nothing until the final number.
 */
import type { ModelInfo } from "@shared/api"
import { calculateApiCostAnthropic } from "@/utils/cost"

export interface TaskUsageMetrics {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost: number | undefined
}

/** The fields `accumulateUsage` reads off a stream's "usage" chunk. */
export interface UsageChunkLike {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	totalCost?: number
}

/**
 * Returns new totals with `chunk` folded into `prev`. Token counts always add. The cost prefers
 * whatever the chunk itself carries (OpenRouter and the free tier report their own, and that
 * figure is authoritative); failing that, when `modelInfo` is given, it is recalculated from the
 * accumulated totals via the same `calculateApiCostAnthropic` the final update already uses, so a
 * mid-stream total and the eventual final one are computed the same way. With neither, the
 * previous cost carries over unchanged.
 */
export function accumulateUsage(prev: TaskUsageMetrics, chunk: UsageChunkLike, modelInfo?: ModelInfo): TaskUsageMetrics {
	const inputTokens = prev.inputTokens + chunk.inputTokens
	const outputTokens = prev.outputTokens + chunk.outputTokens
	const cacheWriteTokens = prev.cacheWriteTokens + (chunk.cacheWriteTokens ?? 0)
	const cacheReadTokens = prev.cacheReadTokens + (chunk.cacheReadTokens ?? 0)

	let totalCost = prev.totalCost
	if (chunk.totalCost !== undefined) {
		totalCost = chunk.totalCost
	} else if (modelInfo) {
		totalCost = calculateApiCostAnthropic(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
	}

	return { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, totalCost }
}
