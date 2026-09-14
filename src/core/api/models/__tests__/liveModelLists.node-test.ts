import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, test } from "node:test"
import { deepSeekModels } from "@shared/api"
import { withoutRetired } from "@shared/liveModels"
import {
	getLiveModelIds,
	type HttpGet,
	isServedLiveModel,
	LIVE_MODEL_LIST_CACHE_FILE,
	LIVE_MODEL_LIST_TTL_MS,
	loadCachedLiveModelLists,
	modelListUrl,
	refreshLiveModelList,
	resetLiveModelLists,
} from "../liveModelLists"

/**
 * The fetch and cache around reconcileModelList: a failed call must never reach the developer as an error,
 * and a list is asked for at most once per cache lifetime.
 */

let dir: string
const silent = () => {}
const request = { provider: "deepseek" as const, apiKey: "sk-test" }
const served = {
	data: [
		{ id: "deepseek-flash", object: "model" },
		{ id: "deepseek-v4-pro", object: "model" },
	],
}

function fakeGet(responses: Array<() => Promise<{ status: number; data: unknown }>>) {
	const calls: Array<{ url: string; headers: Record<string, string> }> = []
	const get: HttpGet = async (url, headers) => {
		calls.push({ url, headers })
		const next = responses.shift()
		if (!next) {
			throw new Error("unexpected extra request")
		}
		return next()
	}
	return { get, calls }
}

beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "live-models-"))
	resetLiveModelLists()
})
afterEach(async () => {
	await rm(dir, { recursive: true, force: true })
})

describe("refreshLiveModelList", () => {
	test("a fetched list replaces the shipped one, and the retired ids are gone", async () => {
		const { get, calls } = fakeGet([async () => ({ status: 200, data: served })])
		const models = await refreshLiveModelList(request, deepSeekModels, { get, cacheDir: async () => dir, log: silent })
		assert.deepEqual(Object.keys(models), ["deepseek-v4-pro", "deepseek-flash"])
		assert.equal(calls[0].url, "https://api.deepseek.com/models")
		assert.equal(calls[0].headers.Authorization, "Bearer sk-test")
		// And the request path now accepts the served id it does not know, but not a stray one.
		assert.equal(isServedLiveModel("deepseek", "deepseek-flash"), true)
		assert.equal(isServedLiveModel("deepseek", "claude-sonnet-5"), false)
	})

	for (const [name, response] of [
		["a network error", async () => Promise.reject(new Error("getaddrinfo ENOTFOUND api.deepseek.com"))],
		["a non-2xx answer", async () => ({ status: 401, data: { error: { message: "Authentication Fails" } } })],
		["a 5xx answer", async () => ({ status: 503, data: "Service Unavailable" })],
		["malformed JSON", async () => ({ status: 200, data: "<html>not json</html>" })],
		["a body that is not a model list", async () => ({ status: 200, data: { data: "nope" } })],
	] as const) {
		test(`${name} falls back to the shipped list and nothing throws`, async () => {
			const logged: string[] = []
			const { get } = fakeGet([response as () => Promise<{ status: number; data: unknown }>])
			const models = await refreshLiveModelList(request, deepSeekModels, {
				get,
				cacheDir: async () => dir,
				log: (m) => logged.push(m),
			})
			assert.deepEqual(models, withoutRetired("deepseek", deepSeekModels)) // the shipped list, less the ids DeepSeek retired
			assert.equal(logged.length, 1, "logged once, for the developer's output channel only")
			// Nothing was cached, so the next call asks again.
			await assert.rejects(readFile(path.join(dir, LIVE_MODEL_LIST_CACHE_FILE), "utf8"))
		})
	}

	test("a cache directory that cannot be read still fetches, and never throws", async () => {
		const { get } = fakeGet([async () => ({ status: 200, data: served })])
		const models = await refreshLiveModelList(request, deepSeekModels, {
			get,
			cacheDir: async () => Promise.reject(new Error("no storage")),
			log: silent,
		})
		assert.ok("deepseek-flash" in models)
	})

	test("without a key nothing is requested and the shipped list is offered", async () => {
		const { get, calls } = fakeGet([])
		const models = await refreshLiveModelList({ provider: "deepseek" }, deepSeekModels, {
			get,
			cacheDir: async () => dir,
			log: silent,
		})
		assert.equal(calls.length, 0)
		assert.deepEqual(models, withoutRetired("deepseek", deepSeekModels)) // the shipped list, less the ids DeepSeek retired
	})
})

describe("the cache", () => {
	test("is used within its lifetime and refreshed after it", async () => {
		let now = 1_000_000
		const { get, calls } = fakeGet([
			async () => ({ status: 200, data: served }),
			async () => ({ status: 200, data: { data: [{ id: "deepseek-v4-pro" }] } }),
		])
		const deps = { get, now: () => now, cacheDir: async () => dir, log: silent }

		assert.equal((await getLiveModelIds(request, deps))?.length, 2)
		assert.equal(calls.length, 1)

		now += LIVE_MODEL_LIST_TTL_MS - 1
		assert.equal((await getLiveModelIds(request, deps))?.length, 2, "served from cache")
		assert.equal(calls.length, 1, "no second request inside the lifetime")

		now += 2
		assert.deepEqual(await getLiveModelIds(request, deps), [{ id: "deepseek-v4-pro" }])
		assert.equal(calls.length, 2, "asked again once the lifetime is over")
	})

	test("a changed base URL is not answered from the other URL's cache", async () => {
		const { get, calls } = fakeGet([
			async () => ({ status: 200, data: { data: [{ id: "claude-sonnet-5" }] } }),
			async () => ({ status: 200, data: { data: [{ id: "claude-sonnet-5" }] } }),
		])
		const deps = { get, cacheDir: async () => dir, log: silent }
		await getLiveModelIds({ provider: "anthropic", apiKey: "k" }, deps)
		await getLiveModelIds({ provider: "anthropic", apiKey: "k", anthropicBaseUrl: "https://gateway.example/" }, deps)
		assert.equal(calls.length, 2)
		assert.equal(calls[1].url, "https://gateway.example/v1/models")
		assert.equal(calls[1].headers["x-api-key"], "k")
		assert.equal(calls[1].headers["anthropic-version"], "2023-06-01")
	})

	test("the served ids come back from disk after a restart", async () => {
		await writeFile(
			path.join(dir, LIVE_MODEL_LIST_CACHE_FILE),
			JSON.stringify({ deepseek: { fetchedAt: 0, url: modelListUrl(request), models: [{ id: "deepseek-flash" }] } }),
		)
		assert.equal(isServedLiveModel("deepseek", "deepseek-flash"), false)
		await loadCachedLiveModelLists({ cacheDir: async () => dir })
		assert.equal(isServedLiveModel("deepseek", "deepseek-flash"), true)
	})
})

describe("modelListUrl", () => {
	test("the GLM Coding Plan list comes from the coding endpoint, on the line the developer chose", () => {
		assert.equal(modelListUrl({ provider: "zai-coding-plan" }), "https://api.z.ai/api/coding/paas/v4/models")
		assert.equal(
			modelListUrl({ provider: "zai-coding-plan", zaiApiLine: "coding-china" }),
			"https://open.bigmodel.cn/api/coding/paas/v4/models",
		)
	})
})
