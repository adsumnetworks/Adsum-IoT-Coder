import { describe, it } from "mocha"
import "should"
import type { ApiProviderInfo } from "@core/api"
import { getToolCallReliabilityTier, isClaude4PlusModelFamily, shouldSkipReasoningForModel } from "../model-utils"

function fakeProviderInfo(providerId: string, modelId: string): ApiProviderInfo {
	return {
		providerId,
		model: { id: modelId, info: {} as ApiProviderInfo["model"]["info"] },
		mode: "act",
	}
}

describe("shouldSkipReasoningForModel", () => {
	it("should return true for grok-4 models", () => {
		shouldSkipReasoningForModel("grok-4").should.equal(true)
		shouldSkipReasoningForModel("x-ai/grok-4").should.equal(true)
		shouldSkipReasoningForModel("openrouter/grok-4-turbo").should.equal(true)
		shouldSkipReasoningForModel("some-provider/grok-4-mini").should.equal(true)
	})

	it("should return false for non-grok-4 models", () => {
		shouldSkipReasoningForModel("grok-3").should.equal(false)
		shouldSkipReasoningForModel("grok-2").should.equal(false)
		shouldSkipReasoningForModel("claude-3-sonnet").should.equal(false)
		shouldSkipReasoningForModel("gpt-4").should.equal(false)
		shouldSkipReasoningForModel("gemini-pro").should.equal(false)
	})

	it("should return false for undefined or empty model IDs", () => {
		shouldSkipReasoningForModel(undefined).should.equal(false)
		shouldSkipReasoningForModel("").should.equal(false)
	})

	it("should be case sensitive", () => {
		shouldSkipReasoningForModel("GROK-4").should.equal(false)
		shouldSkipReasoningForModel("Grok-4").should.equal(false)
	})
})

describe("isClaude4PlusModelFamily", () => {
	it("should return true for Claude 4+ model IDs with version numbers", () => {
		isClaude4PlusModelFamily("claude-sonnet-4-5-20250929").should.equal(true)
		isClaude4PlusModelFamily("claude-opus-4-1-20250805").should.equal(true)
		isClaude4PlusModelFamily("claude-haiku-4-5-20251001").should.equal(true)
		isClaude4PlusModelFamily("claude-4-sonnet").should.equal(true)
	})

	it("should return true for Claude Code short aliases (sonnet, opus)", () => {
		// These are used by ClaudeCodeHandler.getModel() and should be recognized as Claude 4+
		isClaude4PlusModelFamily("sonnet").should.equal(true)
		isClaude4PlusModelFamily("opus").should.equal(true)
	})

	it("should return false for Claude 3.x models", () => {
		isClaude4PlusModelFamily("claude-3-sonnet").should.equal(false)
		isClaude4PlusModelFamily("claude-3.5-sonnet").should.equal(false)
		isClaude4PlusModelFamily("claude-3-opus").should.equal(false)
	})

	it("should return false for non-Claude models", () => {
		isClaude4PlusModelFamily("gpt-4").should.equal(false)
		isClaude4PlusModelFamily("gemini-pro").should.equal(false)
		isClaude4PlusModelFamily("llama-3").should.equal(false)
	})

	it("should strip provider prefixes before matching (OpenRouter / Vertex)", () => {
		isClaude4PlusModelFamily("anthropic/claude-haiku-4-5-20251001").should.equal(true)
		isClaude4PlusModelFamily("anthropic/claude-sonnet-4-5-20250929").should.equal(true)
		isClaude4PlusModelFamily("openrouter/anthropic/claude-opus-4-1-20250805").should.equal(true)
		isClaude4PlusModelFamily("anthropic/claude-3.5-haiku").should.equal(false)
	})

	it('should treat "-latest" Anthropic aliases as Claude 4+', () => {
		// Anthropic API and OpenRouter both currently resolve these to 4.x.
		isClaude4PlusModelFamily("claude-haiku-latest").should.equal(true)
		isClaude4PlusModelFamily("claude-sonnet-latest").should.equal(true)
		isClaude4PlusModelFamily("anthropic/claude-haiku-latest").should.equal(true)
		isClaude4PlusModelFamily("haiku-latest").should.equal(true)
	})
})

describe("getToolCallReliabilityTier", () => {
	it("returns high for Claude 4+, GPT-5, Gemini 2.5/3, Grok-4", () => {
		getToolCallReliabilityTier(fakeProviderInfo("anthropic", "claude-sonnet-4-5-20250929")).should.equal("high")
		getToolCallReliabilityTier(fakeProviderInfo("anthropic", "claude-haiku-4-5-20251001")).should.equal("high")
		getToolCallReliabilityTier(fakeProviderInfo("openai", "gpt-5")).should.equal("high")
		getToolCallReliabilityTier(fakeProviderInfo("gemini", "gemini-2.5-pro")).should.equal("high")
		getToolCallReliabilityTier(fakeProviderInfo("gemini", "gemini-3-pro")).should.equal("high")
		getToolCallReliabilityTier(fakeProviderInfo("xai", "grok-4")).should.equal("high")
	})

	it("returns high for Claude -latest aliases (OpenRouter routing)", () => {
		getToolCallReliabilityTier(fakeProviderInfo("openrouter", "anthropic/claude-haiku-latest")).should.equal("high")
	})

	it("returns medium for DeepSeek-V4, GLM-4.6, Hermes-4, Kimi-K2", () => {
		getToolCallReliabilityTier(fakeProviderInfo("deepseek", "deepseek-v4-pro")).should.equal("medium")
		getToolCallReliabilityTier(fakeProviderInfo("zai", "glm-4.6")).should.equal("medium")
		getToolCallReliabilityTier(fakeProviderInfo("openrouter", "nousresearch/hermes-4")).should.equal("medium")
		getToolCallReliabilityTier(fakeProviderInfo("openrouter", "moonshot/kimi-k2")).should.equal("medium")
	})

	it("returns low for older / smaller Claudes and unknown models", () => {
		getToolCallReliabilityTier(fakeProviderInfo("anthropic", "claude-3.5-haiku")).should.equal("low")
		getToolCallReliabilityTier(fakeProviderInfo("anthropic", "claude-3-haiku")).should.equal("low")
		getToolCallReliabilityTier(fakeProviderInfo("openrouter", "some-random/unknown-model-7b")).should.equal("low")
		getToolCallReliabilityTier(fakeProviderInfo("ollama", "llama-3-8b")).should.equal("low")
	})
})
