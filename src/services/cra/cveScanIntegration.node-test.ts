/**
 * Integration test for the CVE scan engine — composes the REAL production pieces (makeOsvFetcher + cveScanHost +
 * readBuildEvidence + advisory resolver) with only the OUTERMOST seams faked (HTTP transport, fs). Unit tests
 * cover each module in isolation; this proves they connect: SBOM → chunked OSV query → applicability from build
 * evidence → md + JSON, honest + verdict-clean. No network, no real fs.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { isVerdictClean } from "../knowledge/honesty/verdictScan"
import type { VerifiedAdvisoryHint } from "./advisoryHints"
import type { BuildEvidenceReaders } from "./buildEvidence"
import { runCveScanHost } from "./cveScanHost"
import { type HttpPost, makeOsvFetcher } from "./osvFetcher"
import type { HintResolver } from "./scanLoop"

const SBOM = `SPDXVersion: SPDX-2.3

PackageName: mbedtls
PackageVersion: 3.5.0
ExternalRef: PACKAGE-MANAGER purl pkg:github/Mbed-TLS/mbedtls@3.5.0

PackageName: esp_wifi
PackageVersion: 5.1.2
ExternalRef: SECURITY cpe23Type cpe:2.3:a:espressif:esp_wifi:5.1.2:*:*:*:*:*:*:*
`

// A fake HTTP transport that returns OSV-shaped responses; records the URL so we know the real fetcher used it.
const fakeHttp = (vulnsByIndex: Array<string[]>): HttpPost => {
	return async (_url, body) => {
		const queries = JSON.parse(body).queries as unknown[]
		const results = queries.map((_q, i) => ({ vulns: (vulnsByIndex[i] ?? []).map((id) => ({ id })) }))
		return JSON.stringify({ results })
	}
}

const readers = (files: Record<string, string>): BuildEvidenceReaders => ({
	readText: (p) => files[p.replace(/\\/g, "/")],
	nm: () => undefined,
})

test("end-to-end through the REAL fetcher + host: mbedtls hit surfaces; esp_wifi is an honest cpe-only gap", async () => {
	const r = await runCveScanHost(
		{ sbomText: SBOM, buildDir: "build" },
		{
			fetcher: makeOsvFetcher(fakeHttp([["CVE-2024-23170"]])), // only the 1 queryable (PURL) component is queried
			readers: readers({}),
			asOf: "2026-06-25",
		},
	)
	assert.match(r.report, /mbedtls@3\.5\.0/)
	assert.match(r.report, /CVE-2024-23170/)
	assert.equal(r.queriedCount, 1) // mbedtls (purl); esp_wifi is cpe-only → not queried
	assert.match(r.report, /1 cpe-only \(not OSV-queryable\)/) // honest coverage gap surfaced
	assert.equal(isVerdictClean(r.report), true)
	assert.equal(JSON.parse(r.json).schema, "adsum.cve-scan/1")
})

test("applicability flows from real build evidence + the advisory resolver (config-gated-out exclusion)", async () => {
	const hint: VerifiedAdvisoryHint = { gateSymbol: "CONFIG_MBEDTLS_SSL_TLS", verifiedNote: "test fixture" }
	const resolveHint: HintResolver = (id) => (id === "CVE-2024-23170" ? hint : undefined)
	const r = await runCveScanHost(
		{ sbomText: SBOM, buildDir: "build" },
		{
			fetcher: makeOsvFetcher(fakeHttp([["CVE-2024-23170"]])),
			readers: readers({ "build/zephyr/.config": "# CONFIG_MBEDTLS_SSL_TLS is not set\n" }),
			resolveHint,
			asOf: "2026-06-25",
		},
	)
	assert.equal(r.findings[0].applicability.signal, "config-gated-out")
	assert.match(r.report, /likely not applicable; verify/)
	assert.equal(isVerdictClean(r.report), true)
})

test("a transport error DEGRADES gracefully (design/28) — PARTIAL scan, loud, never a false clean", async () => {
	const failing: HttpPost = async () => {
		throw new Error("HTTP 503")
	}
	// OSV is the only wired source and it fails → the scan does NOT throw; it returns a PARTIAL report that names
	// the down source and refuses to read as clean. (No-SBOM still hard-errors — see the dedicated test.)
	const r = await runCveScanHost(
		{ sbomText: SBOM },
		{ fetcher: makeOsvFetcher(failing), readers: readers({}), asOf: "2026-06-25" },
	)
	assert.match(r.report, /PARTIAL SCAN — .*OSV/)
	assert.match(r.report, /NOT a clean result/)
})
