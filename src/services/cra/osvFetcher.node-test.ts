/**
 * Tests for the production OSV fetcher. HTTP is injected, so NO network here (the real-network smoke test lives
 * in osvFetcher.integration.node-test.ts, gated behind RUN_OSV_NETWORK=1 for the operator to run later).
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { type HttpPost, makeOsvFetcher, OSV_BATCH_LIMIT, OSV_QUERYBATCH_URL } from "./osvFetcher"
import type { OsvQuery } from "./osvMatch"

const mkQueries = (n: number): OsvQuery[] => Array.from({ length: n }, (_, i) => ({ package: { purl: `pkg:generic/c${i}@1.0` } }))

test("single batch (≤ limit): one POST to the querybatch URL with the batch body", async () => {
	const calls: Array<{ url: string; body: string }> = []
	const http: HttpPost = async (url, body) => {
		calls.push({ url, body })
		return JSON.stringify({ results: [{ vulns: [{ id: "CVE-1" }] }, {}] })
	}
	const fetcher = makeOsvFetcher(http)
	const out = await fetcher({ queries: mkQueries(2) })
	assert.equal(calls.length, 1)
	assert.equal(calls[0].url, OSV_QUERYBATCH_URL)
	assert.deepEqual(JSON.parse(calls[0].body).queries.length, 2)
	assert.equal(JSON.parse(out).results.length, 2)
})

test("large batch is CHUNKED (no silent truncation) and results merge IN ORDER for index alignment", async () => {
	const total = OSV_BATCH_LIMIT + 500 // 1500 → two chunks (1000 + 500)
	let call = 0
	const http: HttpPost = async (_url, body) => {
		const n = JSON.parse(body).queries.length
		call++
		// Tag each result with its chunk so we can assert ordering survives the merge.
		return JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ chunk: call, i })) })
	}
	const out = JSON.parse(await makeOsvFetcher(http)({ queries: mkQueries(total) }))
	assert.equal(call, 2, "should split into exactly two requests")
	assert.equal(out.results.length, total, "every query must get a result slot — none dropped")
	assert.deepEqual(out.results[0], { chunk: 1, i: 0 }) // first chunk first
	assert.deepEqual(out.results[OSV_BATCH_LIMIT], { chunk: 2, i: 0 }) // second chunk begins exactly at the boundary
})

test("a chunk that returns no results array still contributes one slot per query (alignment preserved)", async () => {
	const total = OSV_BATCH_LIMIT + 3
	const http: HttpPost = async (_url, body) => {
		const n = JSON.parse(body).queries.length
		return n > 100 ? JSON.stringify({ results: Array.from({ length: n }, () => ({})) }) : JSON.stringify({})
	}
	const out = JSON.parse(await makeOsvFetcher(http)({ queries: mkQueries(total) }))
	assert.equal(out.results.length, total) // 1000 real + 3 filler slots
})

test("transport error propagates (a failed scan is never swallowed into 'no vulns')", async () => {
	const http: HttpPost = async () => {
		throw new Error("OSV query failed: HTTP 503 Service Unavailable")
	}
	await assert.rejects(() => makeOsvFetcher(http)({ queries: mkQueries(1) }), /503/)
})
