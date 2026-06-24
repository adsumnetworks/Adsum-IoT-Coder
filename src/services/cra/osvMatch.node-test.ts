import assert from "node:assert/strict"
import { test } from "node:test"
import { type OsvQueryBatch, parseOsvBatch, planOsvScan, scanWithOsv } from "./osvMatch"
import type { SbomComponent } from "./sbomNormalize"

const COMPONENTS: SbomComponent[] = [
	{ name: "mbedtls", version: "3.5.0", purl: "pkg:github/Mbed-TLS/mbedtls@3.5.0", cpe: "cpe:2.3:a:arm:mbed_tls:3.5.0" },
	{ name: "lwip", version: "2.1.3", purl: "pkg:github/lwip-tcpip/lwip@2.1.3" },
	{ name: "esp_wifi", version: "5.1.2", cpe: "cpe:2.3:a:espressif:esp_wifi:5.1.2" }, // cpe-only
	{ name: "vendor_blob", version: "1.0" }, // no identifier
]

test("planOsvScan: PURL components queried; cpe-only + no-id skipped honestly", () => {
	const plan = planOsvScan(COMPONENTS)
	assert.equal(plan.queries.length, 2) // mbedtls, lwip
	assert.equal(plan.queries[0].package.purl, "pkg:github/Mbed-TLS/mbedtls@3.5.0")
	assert.deepEqual(
		plan.skipped.map((s) => `${s.component.name}:${s.reason}`),
		["esp_wifi:cpe-only", "vendor_blob:no-identifier"],
	)
})

test("parseOsvBatch: maps index-aligned results back to components; only hits returned", () => {
	const queried = planOsvScan(COMPONENTS).queried // [mbedtls, lwip]
	const response = JSON.stringify({
		results: [
			{ vulns: [{ id: "CVE-2024-23170" }, { id: "GHSA-xxxx" }] }, // mbedtls
			{}, // lwip — no vulns
		],
	})
	const matches = parseOsvBatch(response, queried)
	assert.equal(matches.length, 1)
	assert.equal(matches[0].component.name, "mbedtls")
	assert.deepEqual(matches[0].vulnIds, ["CVE-2024-23170", "GHSA-xxxx"])
})

test("scanWithOsv: end-to-end with an injected fetcher (no network)", async () => {
	let sentQueryCount = -1
	const fetcher = async (batch: OsvQueryBatch) => {
		sentQueryCount = batch.queries.length
		return JSON.stringify({ results: [{ vulns: [{ id: "CVE-2024-23170" }] }, { vulns: [] }] })
	}
	const res = await scanWithOsv(COMPONENTS, fetcher)
	assert.equal(sentQueryCount, 2) // only PURL components queried
	assert.equal(res.queriedCount, 2)
	assert.equal(res.matches.length, 1)
	assert.equal(res.matches[0].component.name, "mbedtls")
	assert.equal(res.skipped.length, 2) // cpe-only + no-id surfaced
})

test("scanWithOsv: nothing queryable → no fetch, honest skip record", async () => {
	let called = false
	const fetcher = async () => {
		called = true
		return "{}"
	}
	const res = await scanWithOsv([{ name: "blob", version: "1.0" }], fetcher)
	assert.equal(called, false) // never hit the network when there's nothing to query
	assert.equal(res.matches.length, 0)
	assert.equal(res.skipped.length, 1)
})

test("parseOsvBatch: malformed response → empty, not a throw", () => {
	assert.deepEqual(parseOsvBatch("not json", COMPONENTS), [])
})
