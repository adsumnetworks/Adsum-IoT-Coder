/**
 * §8.4 parity test — nRF and ESP must be described with EQUAL HONESTY about their coverage gap, even though
 * ESP's OSV-queryable ratio is structurally lower (CPE-heavy SBOM, PURL-sparse). This test asserts the *honesty
 * symmetry* (both platforms get a reason breakdown, never a bare count), NOT equal coverage numbers — claiming
 * equal numbers would be false for ESP.
 *
 * ┌─ REPRESENTATIVE FIXTURES, NOT REAL CAPTURES ──────────────────────────────────────────────────────────┐
 * │ The two SPDX blobs below are hand-authored to mirror the *shape* of each platform's SBOM (nRF: PURL-heavy │
 * │ like `west ncs-sbom`; ESP: CPE-heavy like `esp-idf-sbom`). They are NOT real tool output.                │
 * │ TODO(spike, design/16 Fact 1): replace with REAL `ncs-sbom` + `esp-idf-sbom` SPDX captured in an NCS/ESP │
 * │ build env, so the genuine day-1 asymmetry number becomes a permanent regression asset. The assertions    │
 * │ below are written to survive that swap unchanged — they test honesty symmetry + structural asymmetry,    │
 * │ never a hard-coded coverage count.                                                                       │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { isVerdictClean } from "../knowledge/honesty/verdictScan"
import type { OsvFetcher } from "./osvMatch"
import { normalizeSbom } from "./sbomNormalize"
import { runCveScan } from "./scanLoop"

// nRF-like: PURL-heavy (zephyr/mbedtls/tinycrypt carry PURLs; one proprietary blob has no id).
const NRF_SPDX_REPRESENTATIVE = `SPDXVersion: SPDX-2.3
DocumentName: ncs-sbom-representative

PackageName: zephyr
PackageVersion: 3.7.0
ExternalRef: PACKAGE-MANAGER purl pkg:github/zephyrproject-rtos/zephyr@3.7.0

PackageName: mbedtls
PackageVersion: 3.5.0
ExternalRef: PACKAGE-MANAGER purl pkg:github/Mbed-TLS/mbedtls@3.5.0

PackageName: tinycrypt
PackageVersion: 0.2.8
ExternalRef: PACKAGE-MANAGER purl pkg:github/intel/tinycrypt@0.2.8

PackageName: nrf_proprietary_blob
PackageVersion: 1.0.0
`

// ESP-like: CPE-heavy (esp components carry CPE but no PURL; one blob has no id) — the structural ESP gap.
const ESP_SPDX_REPRESENTATIVE = `SPDXVersion: SPDX-2.3
DocumentName: esp-idf-sbom-representative

PackageName: mbedtls
PackageVersion: 3.4.0
ExternalRef: PACKAGE-MANAGER purl pkg:github/Mbed-TLS/mbedtls@3.4.0

PackageName: esp_wifi
PackageVersion: 5.1.2
ExternalRef: SECURITY cpe23Type cpe:2.3:a:espressif:esp_wifi:5.1.2:*:*:*:*:*:*:*

PackageName: esp_system
PackageVersion: 5.1.2
ExternalRef: SECURITY cpe23Type cpe:2.3:a:espressif:esp_system:5.1.2:*:*:*:*:*:*:*

PackageName: vendor_blob
PackageVersion: 1.0
`

const noVulnFetcher: OsvFetcher = async (batch) => JSON.stringify({ results: batch.queries.map(() => ({ vulns: [] })) })

/** The "Coverage: …" caption line from a scan report. */
const coverageLine = (report: string): string => report.split("\n").find((l) => l.startsWith("Coverage:")) ?? ""
/** Reason tokens a non-bare breakdown must contain at least one of when there are gaps. */
const REASON_TOKENS = [/cpe-only/, /with no identifier/, /with no version/]

test("both platforms emit a per-component coverage record (queryable + dropReason on every component)", () => {
	for (const spdx of [NRF_SPDX_REPRESENTATIVE, ESP_SPDX_REPRESENTATIVE]) {
		const { components } = normalizeSbom(spdx)
		assert.equal(
			components.every((c) => typeof c.queryable === "boolean" && c.dropReason !== undefined),
			true,
			"every component must carry the §5 coverage fact",
		)
	}
})

test("structural asymmetry is EXPECTED: ESP's queryable ratio is lower than nRF's (not an error)", () => {
	const nrf = normalizeSbom(NRF_SPDX_REPRESENTATIVE).coverage
	const esp = normalizeSbom(ESP_SPDX_REPRESENTATIVE).coverage
	assert.ok(nrf.queryable / nrf.total > esp.queryable / esp.total, "nRF should be more PURL-covered than ESP")
	// ESP's gap is dominated by cpe-only (the documented reason the curated PURL map exists).
	assert.ok((esp.byDropReason["cpe-only"] ?? 0) > 0, "ESP fixture must exhibit the cpe-only gap")
})

test("HONESTY SYMMETRY: when a platform has gaps, its report renders a reason breakdown — never a bare count", async () => {
	const reports = await Promise.all(
		[NRF_SPDX_REPRESENTATIVE, ESP_SPDX_REPRESENTATIVE].map(async (spdx) => {
			const r = await runCveScan({ spdxText: spdx, evidence: {}, asOf: "2026-06-25", fetcher: noVulnFetcher })
			return { coverage: r.coverage, line: coverageLine(r.report), report: r.report }
		}),
	)
	for (const { coverage, line, report } of reports) {
		const hasGaps = coverage.total - coverage.queryable > 0
		assert.ok(hasGaps, "both representative fixtures are designed to have gaps (so both paths are exercised)")
		// The load-bearing parity assertion: a gap MUST be explained with a reason, on BOTH platforms.
		assert.ok(
			REASON_TOKENS.some((re) => re.test(line)),
			`coverage line is a bare count (no reason breakdown) — parity violation:\n${line}`,
		)
		assert.equal(isVerdictClean(report), true, `report tripped verdictScan:\n${report}`)
	}
})

test("parity is honesty, not equal numbers: the two coverage lines differ (asymmetry surfaced, not hidden)", async () => {
	const [nrf, esp] = await Promise.all(
		[NRF_SPDX_REPRESENTATIVE, ESP_SPDX_REPRESENTATIVE].map(async (spdx) => {
			const r = await runCveScan({ spdxText: spdx, evidence: {}, asOf: "2026-06-25", fetcher: noVulnFetcher })
			return coverageLine(r.report)
		}),
	)
	assert.notEqual(nrf, esp, "the asymmetry must be visible in the reports, not normalized away")
	assert.match(esp, /cpe-only/, "ESP's report must name its cpe-only gap explicitly")
})
