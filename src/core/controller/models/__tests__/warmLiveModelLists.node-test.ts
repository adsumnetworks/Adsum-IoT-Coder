import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { warmLiveModelLists } from "../refreshDirectProviderModels"

/**
 * Part 4: the live lists are fetched at startup, not only when a picker opens. Only providers with a saved key
 * are asked, and a failing provider neither stops the others nor throws.
 *
 * Run: npm run test:node (scripts/run-node-tests.mjs)
 */
const state = (secrets: Record<string, string | undefined>) => ({
	getSecretKey: ((k: string) => secrets[k]) as never,
	getGlobalSettingsKey: (() => undefined) as never,
})

describe("startup fetch of the live model lists", () => {
	test("every provider with a saved key is asked, and only those", async () => {
		const seen: string[] = []
		const asked = await warmLiveModelLists(state({ deepSeekApiKey: "k1", zaiApiKey: "k2" }), (async (req: {
			provider: string
		}) => {
			seen.push(req.provider)
			return {}
		}) as never)
		assert.deepEqual(asked, ["deepseek", "zai-coding-plan"])
		assert.deepEqual(seen.sort(), ["deepseek", "zai-coding-plan"])
	})

	test("no saved keys, nothing is asked", async () => {
		let calls = 0
		const asked = await warmLiveModelLists(state({}), (async () => {
			calls++
			return {}
		}) as never)
		assert.deepEqual([asked.length, calls], [0, 0])
	})

	test("a provider that fails does not stop the others and nothing throws", async () => {
		const done: string[] = []
		await assert.doesNotReject(
			warmLiveModelLists(state({ deepSeekApiKey: "a", apiKey: "b", zaiApiKey: "c" }), (async (req: {
				provider: string
			}) => {
				if (req.provider === "anthropic") throw new Error("offline")
				done.push(req.provider)
				return {}
			}) as never),
		)
		assert.deepEqual(done.sort(), ["deepseek", "zai-coding-plan"])
	})
})
