/**
 * Tests for the CPE→NVD matcher (F11). node:test via `npm run test:cve` (ts-node). Pure parse + scan with an
 * injected fetcher; the real-network case is gated behind RUN_NVD_NETWORK=1.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { makeNvdFetcher } from "./nvdFetcher"
import { parseNvdResponse, scanWithNvd } from "./nvdMatch"
import type { SbomComponent } from "./sbomNormalize"

const SAMPLE = JSON.stringify({
	totalResults: 2,
	vulnerabilities: [
		{ cve: { id: "CVE-2019-16910", metrics: { cvssMetricV31: [{ cvssData: { baseSeverity: "MEDIUM" } }] } } },
		{ cve: { id: "CVE-2021-24119", metrics: { cvssMetricV2: [{ baseSeverity: "HIGH" }] } } },
	],
})

test("parseNvdResponse: extracts ids + severity (v3.1 + v2 fallback)", () => {
	assert.deepEqual(parseNvdResponse(SAMPLE), [
		{ id: "CVE-2019-16910", severity: "MEDIUM" },
		{ id: "CVE-2021-24119", severity: "HIGH" },
	])
})

test("parseNvdResponse: tolerant of bad json / missing metrics", () => {
	assert.deepEqual(parseNvdResponse("not json"), [])
	assert.deepEqual(parseNvdResponse(JSON.stringify({ vulnerabilities: [{ cve: { id: "CVE-2020-0001" } }] })), [
		{ id: "CVE-2020-0001", severity: undefined },
	])
})

test("scanWithNvd: queries CPE-bearing components, skips the rest (never silently)", async () => {
	const comps: SbomComponent[] = [
		{ name: "mbedtls", version: "2.16.0", cpe: "cpe:2.3:a:arm:mbed_tls:2.16.0:*:*:*:*:*:*:*" },
		{ name: "myapp", version: "1.0.0" },
	]
	const res = await scanWithNvd(comps, async () => SAMPLE)
	assert.equal(res.queriedCount, 1)
	assert.equal(res.matches.length, 1)
	assert.equal(res.matches[0].component.name, "mbedtls")
	assert.equal(res.matches[0].vulns.length, 2)
	assert.deepEqual(res.skipped, [{ component: comps[1], reason: "no-cpe" }])
})

test("scanWithNvd: a fetcher error propagates (a network failure is NOT a clean result)", async () => {
	await assert.rejects(
		scanWithNvd([{ name: "x", version: "1", cpe: "cpe:2.3:a:x:x:1:*:*:*:*:*:*:*" }], async () => {
			throw new Error("HTTP 503")
		}),
	)
})

// Proves the real CPE→NVD path finds CVEs that PURL→OSV misses for embedded C libs. Run: RUN_NVD_NETWORK=1.
test("INTEGRATION (network): mbed TLS CPE → real NVD CVEs", { skip: process.env.RUN_NVD_NETWORK !== "1" }, async () => {
	const res = await scanWithNvd(
		[{ name: "mbedtls", version: "2.16.0", cpe: "cpe:2.3:a:arm:mbed_tls:2.16.0:*:*:*:*:*:*:*" }],
		makeNvdFetcher(),
	)
	assert.ok((res.matches[0]?.vulns.length ?? 0) > 0, "expected real CVEs from NVD by CPE")
})
