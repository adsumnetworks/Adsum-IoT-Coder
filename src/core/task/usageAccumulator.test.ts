import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ModelInfo } from "@shared/api"
import { accumulateUsage, TaskUsageMetrics } from "./usageAccumulator"

/**
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/task/usageAccumulator.test.ts
 */
const ZERO: TaskUsageMetrics = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, totalCost: undefined }

const MODEL: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: false,
	supportsPromptCache: true,
	inputPrice: 3, // $ per million tokens
	outputPrice: 15,
	cacheReadsPrice: 0.3,
	cacheWritesPrice: 3.75,
}

describe("accumulateUsage — folding one usage chunk into the running totals", () => {
	test("input and output tokens add across chunks", () => {
		const afterFirst = accumulateUsage(ZERO, { inputTokens: 100, outputTokens: 20 })
		const afterSecond = accumulateUsage(afterFirst, { inputTokens: 50, outputTokens: 10 })
		assert.equal(afterSecond.inputTokens, 150)
		assert.equal(afterSecond.outputTokens, 30)
	})

	test("cache reads and writes add across chunks, defaulting to 0 when absent", () => {
		const afterFirst = accumulateUsage(ZERO, { inputTokens: 100, outputTokens: 20, cacheWriteTokens: 40, cacheReadTokens: 5 })
		const afterSecond = accumulateUsage(afterFirst, { inputTokens: 10, outputTokens: 2 })
		assert.equal(afterSecond.cacheWriteTokens, 40)
		assert.equal(afterSecond.cacheReadTokens, 5)
	})

	test("a chunk-supplied cost (OpenRouter, the free tier) wins outright", () => {
		const result = accumulateUsage(ZERO, { inputTokens: 100, outputTokens: 20, totalCost: 0.0042 }, MODEL)
		assert.equal(result.totalCost, 0.0042)
	})

	test("without a chunk cost, it is computed from the accumulated totals via the model's prices", () => {
		const result = accumulateUsage(ZERO, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, MODEL)
		// 1M in @ $3/M + 1M out @ $15/M = $18, no cache activity
		assert.equal(result.totalCost, 18)
	})

	test("a running cost reflects the accumulated totals, not just the latest chunk", () => {
		const afterFirst = accumulateUsage(ZERO, { inputTokens: 1_000_000, outputTokens: 0 }, MODEL)
		const afterSecond = accumulateUsage(afterFirst, { inputTokens: 0, outputTokens: 1_000_000 }, MODEL)
		assert.equal(afterSecond.totalCost, 18)
	})

	test("with no chunk cost and no model info, the previous cost carries over unchanged", () => {
		const prev: TaskUsageMetrics = {
			inputTokens: 10,
			outputTokens: 5,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 1.23,
		}
		const result = accumulateUsage(prev, { inputTokens: 1, outputTokens: 1 })
		assert.equal(result.totalCost, 1.23)
	})
})
