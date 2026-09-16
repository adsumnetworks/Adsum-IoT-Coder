import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"
import type { ApiProviderInfo } from "@core/api"
import { deepSeekDefaultModelId, deepSeekModels } from "@shared/api"
import { isDeepSeekNativeToolsModelFamily, isNativeToolCallingConfig, isNextGenModelFamily } from "../model-utils"

/**
 * DeepSeek first-class support.
 *
 * Three separate defects made the native DeepSeek provider worse than pointing the generic
 * OpenAI-compatible provider at api.deepseek.com:
 *   1. "deepseek" was missing from isNextGenModelProvider, so native tool calling was unreachable
 *      on the native provider while the generic one got it for free.
 *   2. The in-chat model picker filtered "deepseek" out, so switching to it meant full Settings.
 *   3. The catalogue was stale: 8K max output against a real 384K, cache-read prices 10-24x too
 *      high, and a default model DeepSeek had already retired.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/utils/__tests__/deepseekSupport.node-test.ts
 */

const providerInfo = (providerId: string, modelId: string): ApiProviderInfo =>
	({ providerId, model: { id: modelId, info: {} }, mode: "act" }) as ApiProviderInfo

describe("native tool calling reaches the native DeepSeek provider", () => {
	test("V4 models on the deepseek provider get native tool calls", () => {
		assert.equal(isNativeToolCallingConfig(providerInfo("deepseek", "deepseek-v4-pro"), true), true)
		assert.equal(isNativeToolCallingConfig(providerInfo("deepseek", "deepseek-v4-flash"), true), true)
	})

	test("the native provider is no longer worse than the generic workaround", () => {
		// The bug: this passed while the line above failed, so the manual setup beat the built-in one.
		assert.equal(
			isNativeToolCallingConfig(providerInfo("openai", "deepseek-v4-pro"), true),
			isNativeToolCallingConfig(providerInfo("deepseek", "deepseek-v4-pro"), true),
		)
	})

	test("older DeepSeek chat models are still excluded — they cannot do tool_calls", () => {
		assert.equal(isDeepSeekNativeToolsModelFamily("deepseek-chat"), false)
		assert.equal(isNextGenModelFamily("deepseek-chat"), false)
	})

	test("the setting still wins: native calls off means off", () => {
		assert.equal(isNativeToolCallingConfig(providerInfo("deepseek", "deepseek-v4-pro"), false), false)
	})
})

describe("catalogue matches DeepSeek's published figures (re-read 2026-09-16)", () => {
	// PEAK rates, which are the list price; DeepSeek halves them outside 01:00–04:00 and
	// 06:00–10:00 UTC on weekdays, and PRICING_SCHEDULES applies that at calculation time.
	//
	// [OPERATOR 2026-09-04] The figures this file previously asserted — out 0.28 / 0.87, miss
	// 0.14 / 0.435, hit 0.0028 / 0.003625 — matched nothing on the page: flash output alone was
	// 4.7x under the peak rate and still under the off-peak one. They were pinned to a date and
	// never re-read, which is the whole failure mode a hardcoded price table has. The numbers
	// below were taken from api-docs.deepseek.com/quick_start/pricing on 2026-09-04, and the
	// durable fix is the fetched overlay (refreshDirectModelPrices) that lets them change without
	// a release; this test guards the OFFLINE fallback those prices fall back to.
	// Re-read 2026-09-16: the served pair is `deepseek-flash` (V4.1-Flash) and `deepseek-v4-pro`. The
	// legacy `deepseek-v4-flash` id is still accepted but its model is retired — those requests are
	// served by V4.1-Flash and billed at the Flash price, so it must carry Flash's figures, not the
	// ones it shipped with. Until this read, `deepseek-flash` had no entry at all: it showed a 128K
	// context, no cache support, no prices and no thinking controls, all of them fallback defaults.
	const published = {
		"deepseek-flash": { maxTokens: 384_000, contextWindow: 1_000_000, out: 1.2, miss: 0.3, hit: 0.006 },
		"deepseek-v4-flash": { maxTokens: 384_000, contextWindow: 1_000_000, out: 1.2, miss: 0.3, hit: 0.006 },
		"deepseek-v4-pro": { maxTokens: 384_000, contextWindow: 1_000_000, out: 3.96, miss: 1.32, hit: 0.044 },
	} as const

	for (const [id, want] of Object.entries(published)) {
		test(id, () => {
			// ModelInfo mixes numbers and booleans, so go through unknown rather than pretending
			// every field is a number.
			const m = (deepSeekModels as unknown as Record<string, Record<string, number>>)[id]
			assert.ok(m, `${id} must exist in the catalogue`)
			assert.equal(m.maxTokens, want.maxTokens, "max output tokens")
			assert.equal(m.contextWindow, want.contextWindow, "context window")
			assert.equal(m.outputPrice, want.out, "output price")
			assert.equal(m.cacheWritesPrice, want.miss, "cache MISS price (real input cost)")
			assert.equal(m.cacheReadsPrice, want.hit, "cache HIT price")
		})
	}

	test("the default model is one DeepSeek still sells", () => {
		// deepseek-chat and deepseek-reasoner no longer appear on DeepSeek's pricing page.
		assert.ok(deepSeekDefaultModelId.includes("v4"), `default must be a current model, got "${deepSeekDefaultModelId}"`)
	})

	test("legacy ids remain so an existing saved configuration still resolves", () => {
		assert.ok("deepseek-chat" in deepSeekModels)
		assert.ok("deepseek-reasoner" in deepSeekModels)
	})
})

describe("the in-chat picker offers DeepSeek", () => {
	test("ModelPickerModal does not filter deepseek out", () => {
		// Guards the literal cause of "DeepSeek is manual": a working provider dropped by an allowlist.
		const src = fs.readFileSync(path.join(process.cwd(), "webview-ui/src/components/chat/ModelPickerModal.tsx"), "utf8")
		const filter = src.slice(src.indexOf("const configuredProviders"), src.indexOf("}, [apiConfiguration"))
		assert.match(filter, /p === "deepseek"/, "deepseek must survive the provider filter")
	})
})
