import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { splitOpenAiUsage } from "./openai-usage"

/**
 * Guards the RC-1 fix: OpenAI-compatible `prompt_tokens` already INCLUDES the cached
 * share, so providers must yield disjoint buckets — otherwise the context gauge
 * (which sums in+out+cacheR+cacheW) double-counts every cached token (~×1.9 measured
 * on real zai-coding-plan sessions) and compacts at ~half the real window.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/api/transform/openai-usage.test.ts
 */
describe("splitOpenAiUsage — buckets must be disjoint", () => {
	test("buckets sum back to prompt_tokens (the gauge invariant)", () => {
		const u = splitOpenAiUsage({
			prompt_tokens: 100_000,
			completion_tokens: 500,
			prompt_tokens_details: { cached_tokens: 94_000 },
		})
		assert.equal(u.inputTokens + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0), 100_000)
		assert.equal(u.inputTokens, 6_000)
		assert.equal(u.cacheReadTokens, 94_000)
	})

	test("regression: cache-heavy zai-style record does not inflate the gauge", () => {
		const u = splitOpenAiUsage({
			prompt_tokens: 88_229,
			completion_tokens: 1_000,
			prompt_tokens_details: { cached_tokens: 83_000 },
		})
		const gaugeSum = u.inputTokens + u.outputTokens + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
		assert.equal(gaugeSum, 88_229 + 1_000)
	})

	test("DeepSeek-style hit/miss fields are honored", () => {
		const u = splitOpenAiUsage({
			prompt_tokens: 50_000,
			completion_tokens: 10,
			prompt_cache_hit_tokens: 30_000,
			prompt_cache_miss_tokens: 20_000,
		})
		assert.equal(u.inputTokens, 0)
		assert.equal(u.cacheReadTokens, 30_000)
		assert.equal(u.cacheWriteTokens, 20_000)
	})

	test("prompt_tokens_details.cached_tokens wins when both shapes are present", () => {
		const u = splitOpenAiUsage({
			prompt_tokens: 10_000,
			prompt_tokens_details: { cached_tokens: 4_000 },
			prompt_cache_hit_tokens: 9_999,
		})
		assert.equal(u.cacheReadTokens, 4_000)
		assert.equal(u.inputTokens, 6_000)
	})

	test("no cache info → everything is input", () => {
		const u = splitOpenAiUsage({ prompt_tokens: 1234, completion_tokens: 56 })
		assert.equal(u.inputTokens, 1234)
		assert.equal(u.cacheReadTokens, 0)
		assert.equal(u.cacheWriteTokens, 0)
	})

	test("never negative on malformed provider data", () => {
		const u = splitOpenAiUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 150 } })
		assert.equal(u.inputTokens, 0)
	})
})
