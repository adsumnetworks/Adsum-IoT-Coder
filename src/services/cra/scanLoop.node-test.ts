/**
 * Tests for the CVE scan orchestrator (`runCveScan`). node:test via `npm run test:cve` (ts-node). The fetcher
 * is injected, so there is NO network; the whole loop is deterministic given a fixed fetcher + asOf.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { isVerdictClean } from "../knowledge/honesty/verdictScan"
import type { NvdFetcher } from "./nvdMatch"
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

// NVD returns one HIGH CVE for any queried CPE (here: esp_wifi, which OSV skipped as cpe-only).
const nvdFetcher: NvdFetcher = async () =>
	JSON.stringify({
		vulnerabilities: [{ cve: { id: "CVE-2023-1111", metrics: { cvssMetricV31: [{ cvssData: { baseSeverity: "HIGH" } }] } } }],
	})

test("F11: CPE→NVD path queries the cpe-only component OSV skipped, surfaces its CVE, credits coverage", async () => {
	const r = await runCveScan({ spdxText: SPDX, evidence: {}, asOf: "2026-06-25", fetcher: noVulnFetcher, nvdFetcher })
	assert.equal(isVerdictClean(r.report), true, `report tripped verdictScan:\n${r.report}`)
	assert.match(r.report, /CVE-2023-1111/)
	assert.ok(r.findings.some((f) => f.match.component.name === "esp_wifi" && f.match.vulnIds[0] === "CVE-2023-1111"))
	assert.equal(r.queriedCount, 2) // mbedtls (purl, OSV) + esp_wifi (cpe, NVD)
	assert.ok(!r.skipped.some((s) => s.component.name === "esp_wifi")) // no longer cpe-only-skipped
})

test("F11: no nvdFetcher → behaviour unchanged (cpe-only still skipped, 1 queryable)", async () => {
	const r = await runCveScan({ spdxText: SPDX, evidence: {}, asOf: "2026-06-25", fetcher: noVulnFetcher })
	assert.equal(r.queriedCount, 1)
	assert.ok(r.skipped.some((s) => s.component.name === "esp_wifi" && s.reason === "cpe-only"))
})

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

test("curated PURL map (opt-in via resolveModuleVersion) makes a version-less NCS module queryable + scannable", async () => {
	// An NCS-shaped SBOM: a module with a name but NO version + NO purl (the real Fact-1 case).
	const ncs = `SPDXVersion: SPDX-2.3

PackageName: mcuboot-deps
`
	// Without a version source: 0 queryable (honest gap).
	const off = await runCveScan({ spdxText: ncs, evidence: {}, asOf: "2026-06-25", fetcher: noVulnFetcher })
	assert.equal(off.queriedCount, 0)
	// With the operator's version source: the curated coordinate + version → a real OSV query.
	let queriedPurl = ""
	const fetcher: OsvFetcher = async (batch) => {
		queriedPurl = batch.queries[0]?.package.purl ?? ""
		return JSON.stringify({ results: [{ vulns: [{ id: "CVE-2025-0001" }] }] })
	}
	const on = await runCveScan({
		spdxText: ncs,
		evidence: {},
		asOf: "2026-06-25",
		fetcher,
		resolveModuleVersion: (n) => (n === "mcuboot" ? "2.1.0" : undefined),
	})
	assert.equal(queriedPurl, "pkg:github/mcu-tools/mcuboot@2.1.0")
	assert.equal(on.queriedCount, 1)
	assert.equal(on.findings.length, 1)
	assert.equal(isVerdictClean(on.report), true)
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

test("Zephyr CORE detection (P1a): curated CPE + semver resolver → CPE→NVD finds the core's CVE", async () => {
	// Real shape: `west spdx` emits the Zephyr core as `zephyr-sources` with a git SHA and NO CPE/PURL — so it is
	// undetectable as-is. Fake NVD returns a Zephyr CVE ONLY for the zephyr CPE (proving the curated CPE reached it).
	const zephyrSbom = `SPDXVersion: SPDX-2.3

PackageName: zephyr-sources
PackageVersion: ec78104f15691cccd94682cf4b22e0a013f28dd8-dirty
`
	const nvd: NvdFetcher = async (cpe) =>
		cpe.includes("zephyrproject:zephyr")
			? JSON.stringify({ vulnerabilities: [{ cve: { id: "CVE-2025-10456" } }] })
			: JSON.stringify({ vulnerabilities: [] })

	// WITHOUT the core resolver: the SHA can't form a CPE → Zephyr stays a gap → no NVD query → no finding (honest).
	const without = await runCveScan({
		spdxText: zephyrSbom,
		evidence: {},
		asOf: "2026-06-28",
		fetcher: noVulnFetcher,
		nvdFetcher: nvd,
	})
	assert.equal(without.findings.length, 0)

	// WITH the core resolver (zephyr/VERSION → 4.2.99): curated CPE filled → NVD queried → the real CVE surfaces.
	const withCore = await runCveScan({
		spdxText: zephyrSbom,
		evidence: {},
		asOf: "2026-06-28",
		fetcher: noVulnFetcher,
		nvdFetcher: nvd,
		resolveCoreVersion: (n) => (n === "zephyr" ? "4.2.99" : undefined),
	})
	const ids = withCore.findings.flatMap((f) => f.match.vulnIds)
	assert.ok(ids.includes("CVE-2025-10456"), `expected the Zephyr core CVE; got ${ids.join(",") || "none"}`)
})
