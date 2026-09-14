import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, test } from "node:test"
import { anthropicDefaultModelId, deepSeekDefaultModelId, deepSeekModels } from "@shared/api"
import { hasUnknownPrices } from "@shared/liveModels"
import { LIVE_MODEL_LIST_CACHE_FILE, loadCachedLiveModelLists, resetLiveModelLists } from "../../models/liveModelLists"
import { AnthropicHandler } from "../anthropic"
import { DeepSeekHandler } from "../deepseek"
import { ZAiHandler } from "../zai"

/**
 * What a handler sends for a model chosen from a live list: a served id the shipped table does not know goes
 * out as chosen (not swapped for the default), a retired id still saved in settings does not crash, and a
 * stray id from a different provider is never sent.
 */

let dir: string
const serve = async (lists: Record<string, string[]>) => {
	const file = Object.fromEntries(
		Object.entries(lists).map(([p, ids]) => [p, { fetchedAt: 0, url: "x", models: ids.map((id) => ({ id })) }]),
	)
	await writeFile(path.join(dir, LIVE_MODEL_LIST_CACHE_FILE), JSON.stringify(file))
	await loadCachedLiveModelLists({ cacheDir: async () => dir })
}

beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "live-resolution-"))
	resetLiveModelLists()
})
afterEach(async () => {
	resetLiveModelLists()
	await rm(dir, { recursive: true, force: true })
})

describe("DeepSeek", () => {
	test("a served id the shipped table does not know is sent as chosen, with no prices", async () => {
		await serve({ deepseek: ["deepseek-flash", "deepseek-v4-pro"] })
		const model = new DeepSeekHandler({ apiModelId: "deepseek-flash" }).getModel()
		assert.equal(model.id, "deepseek-flash")
		assert.equal(hasUnknownPrices(model.info), true)
	})

	test("a retired id still saved in settings resolves without crashing", async () => {
		await serve({ deepseek: ["deepseek-flash", "deepseek-v4-pro"] })
		const model = new DeepSeekHandler({ apiModelId: "deepseek-v4-flash" }).getModel()
		assert.equal(model.id, "deepseek-v4-flash")
		assert.equal(model.info.outputPrice, deepSeekModels["deepseek-v4-flash"].outputPrice)
	})

	test("an id that is neither shipped nor served falls back to the default", async () => {
		await serve({ deepseek: ["deepseek-flash"] })
		assert.equal(new DeepSeekHandler({ apiModelId: "claude-sonnet-5" }).getModel().id, deepSeekDefaultModelId)
	})
})

describe("Anthropic and the GLM Coding Plan", () => {
	test("a served Claude id is sent as chosen; an unserved one falls back", async () => {
		await serve({ anthropic: ["claude-opus-5"] })
		assert.equal(new AnthropicHandler({ apiModelId: "claude-opus-5" }).getModel().id, "claude-opus-5")
		assert.equal(new AnthropicHandler({ apiModelId: "deepseek-flash" }).getModel().id, anthropicDefaultModelId)
	})

	test("a served coding-plan id is sent as chosen, only on the coding plan", async () => {
		await serve({ "zai-coding-plan": ["glm-5.3"] })
		const coding = new ZAiHandler({ zaiApiLine: "coding", apiModelId: "glm-5.3" } as never).getModel()
		assert.equal(coding.id, "glm-5.3")
		const payg = new ZAiHandler({ zaiApiLine: "international", apiModelId: "glm-5.3" } as never).getModel()
		assert.notEqual(payg.id, "glm-5.3")
	})
})
