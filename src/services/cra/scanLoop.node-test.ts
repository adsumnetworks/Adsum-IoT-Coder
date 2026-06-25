/**
 * Tests for the CVE scan orchestrator (`runCveScan`). node:test via `npm run test:cve` (ts-node). The fetcher
 * is injected, so there is NO network; the whole loop is deterministic given a fixed fetcher + asOf.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { isVerdictClean } from "../knowledge/honesty/verdictScan"
import type { OsvFetcher } from "./osvMatch"
import { type HintResolver, runCveScan } from "./scanLoop"

// app (no id) · mbedtls (purl → queried) · esp_wifi (cpe-only → skipped) · vendor_blob (no id → skipped).
const SPDX = `SPDXVersion: SPDX-2.3
DataLicense: CC0-1.0

PackageName: app
PackageVersion: 0.1.0

PackageName: mbedtls
PackageVersion: 3.5.0
ExternalRef: PACKAGE-MANAGER purl pkg:github/Mbed-TLS/mbedtls@3.5.0

PackageName: esp_wifi
PackageVersion: 5.1.2
ExternalRef: SECURITY cpe23Type cpe:2.3:a:espressif:esp_wifi:5.1.2:*:*:*:*:*:*:*

PackageName: vendor_blob
PackageVersion: 1.0
`

// mbedtls is queries[0] → two CVE ids reported for it.
const twoVulnFetcher: OsvFetcher = async () =>
	JSON.stringify({ results: [{ vulns: [{ id: "CVE-2024-23170" }, { id: "CVE-2099-0001" }] }] })

const noVulnFetcher: OsvFetcher = async () => JSON.stringify({ results: [{}] })

test("end-to-end: normalize → scan → assess → report (verdict-clean, attributed + dated)", async () => {
	const r = await runCveScan({ spdxText: SPDX, evidence: {}, asOf: "2026-06-25", fetcher: twoVulnFetcher })
	assert.equal(isVerdictClean(r.report), true, `report tripped verdictScan:\n${r.report}`)
	assert.match(r.report, /CVE scan — OSV, as of 2026-06-25/)
	assert.match(r.report, /CVE-2024-23170/)
	assert.equal(r.queriedCount, 1) // only mbedtls had a PURL
	// Coverage comes from the normalizer: 4 total, 1 purl, 1 cpe, 2 unidentified, with the reason breakdown.
	assert.deepEqual(r.coverage, {
		total: 4,
		withPurl: 1,
		withCpe: 1,
		unidentified: 2,
		queryable: 1, // mbedtls (purl)
		byDropReason: { "no-id": 2, "cpe-only": 1 }, // app + vendor_blob (no id), esp_wifi (cpe-only)
	})
})

test("orchestrator returns the §7 JSON artifact alongside the markdown (parseable, same findings)", async () => {
	const r = await runCveScan({ spdxText: SPDX, evidence: {}, asOf: "2026-06-25", fetcher: twoVulnFetcher })
	const doc = JSON.parse(r.json)
	assert.equal(doc.schema, "adsum.cve-scan/1")
	assert.equal(doc.findings.length, r.findings.length) // json + md built from the same findings
	assert.equal(doc.coverage.queryable, r.queriedCount)
})

test("enrichment off by default → no enrichment map entries, no extra network", async () => {
	const r = await runCveScan({ spdxText: SPDX, evidence: {}, asOf: "2026-06-25", fetcher: twoVulnFetcher })
	assert.equal(r.enrichment.size, 0)
})

test("enrichment on (vulnFetcher provided) → severity + fixed surfaced verbatim, verdict-clean", async () => {
	const vulnFetcher = async (id: string) =>
		JSON.stringify({
			id,
			severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
			affected: [{ ranges: [{ events: [{ fixed: "3.5.1" }] }] }],
		})
	const r = await runCveScan({ spdxText: SPDX, evidence: {}, asOf: "2026-06-25", fetcher: twoVulnFetcher, vulnFetcher })
	assert.ok(r.enrichment.size >= 1)
	assert.match(r.report, /CVSS:3\.1\//) // vector surfaced verbatim
	assert.match(r.report, /fixed in 3\.5\.1 \(as of 2026-06-25\) — verify/)
	assert.equal(isVerdictClean(r.report), true) // attributed + dated + hedged stays clean
	const doc = JSON.parse(r.json)
	assert.equal(doc.findings[0].advisories[0].fixedVersions[0], "3.5.1")
	assert.equal(doc.findings[0].advisories[0].severities[0].type, "CVSS_V3")
})

test("per-CVE findings: one finding per (component, vulnId), not collapsed per component", async () => {
	const r = await runCveScan({ spdxText: SPDX, evidence: {}, asOf: "2026-06-25", fetcher: twoVulnFetcher })
	assert.equal(r.findings.length, 2) // mbedtls carried 2 CVEs → 2 findings
	assert.deepEqual(r.findings.flatMap((f) => f.match.vulnIds).sort(), ["CVE-2024-23170", "CVE-2099-0001"])
	assert.equal(
		r.findings.every((f) => f.match.vulnIds.length === 1),
		true,
	)
})

test("a gated-out CVE never masks a sibling CVE on the same component", async () => {
	// CVE-2024-23170 is config-gated-out (its gate is =n); CVE-2099-0001 has no hint → stays "unknown".
	const resolve: HintResolver = (id) => (id === "CVE-2024-23170" ? { gateSymbol: "CONFIG_MBEDTLS_TLS" } : undefined)
	const r = await runCveScan({
		spdxText: SPDX,
		evidence: { dotConfig: "CONFIG_MBEDTLS_TLS=n" },
		asOf: "2026-06-25",
		fetcher: twoVulnFetcher,
		resolveHint: resolve,
	})
	const gated = r.findings.find((f) => f.match.vulnIds[0] === "CVE-2024-23170")
	const sibling = r.findings.find((f) => f.match.vulnIds[0] === "CVE-2099-0001")
	assert.equal(gated?.applicability.signal, "config-gated-out")
	assert.equal(sibling?.applicability.signal, "unknown") // NOT swallowed by the gated-out sibling
	assert.match(r.report, /No applicability signal/) // the unknown line survives in the report
	assert.equal(isVerdictClean(r.report), true)
})

test("no queryable components → no fetch, honest skip, not framed as 'clean'", async () => {
	const cpeAndBlobOnly = `SPDXVersion: SPDX-2.3

PackageName: esp_wifi
PackageVersion: 5.1.2
ExternalRef: SECURITY cpe23Type cpe:2.3:a:espressif:esp_wifi:5.1.2:*:*:*:*:*:*:*

PackageName: blob
PackageVersion: 1.0
`
	let called = false
	const tripwire: OsvFetcher = async () => {
		called = true
		return "{}"
	}
	const r = await runCveScan({ spdxText: cpeAndBlobOnly, evidence: {}, asOf: "2026-06-25", fetcher: tripwire })
	assert.equal(called, false, "fetcher must not be called when nothing is queryable")
	assert.equal(r.queriedCount, 0)
	assert.equal(r.findings.length, 0)
	assert.doesNotMatch(r.report, /\bclean\b/i)
	assert.match(r.report, /1 cpe-only \(not OSV-queryable\)/)
	assert.equal(isVerdictClean(r.report), true)
})

test("matches but no applicability evidence → 'unknown', report stays verdict-clean", async () => {
	const r = await runCveScan({ spdxText: SPDX, evidence: {}, asOf: "2026-06-25", fetcher: twoVulnFetcher })
	assert.equal(
		r.findings.every((f) => f.applicability.signal === "unknown"),
		true,
	)
	assert.equal(isVerdictClean(r.report), true)
})

test("zero matches from a real query → honest no-match framing (not 'clean')", async () => {
	const r = await runCveScan({ spdxText: SPDX, evidence: {}, asOf: "2026-06-25", fetcher: noVulnFetcher })
	assert.equal(r.findings.length, 0)
	assert.equal(r.queriedCount, 1) // we DID query mbedtls; it just had no vulns
	assert.match(r.report, /No OSV matches as of 2026-06-25/)
	assert.match(r.report, /not a complete check/)
	assert.equal(isVerdictClean(r.report), true)
})
