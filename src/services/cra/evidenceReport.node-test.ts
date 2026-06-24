import assert from "node:assert/strict"
import { test } from "node:test"
import { isVerdictClean } from "../knowledge/honesty/verdictScan"
import { assessApplicability } from "./applicability"
import { formatCveScanReport } from "./evidenceReport"
import type { OsvMatch, SkippedComponent } from "./osvMatch"

const mbed: OsvMatch = {
	component: { name: "mbedtls", version: "3.5.0", purl: "pkg:github/Mbed-TLS/mbedtls@3.5.0" },
	vulnIds: ["CVE-2024-23170", "GHSA-aaaa-bbbb-cccc"],
}
const skipped: SkippedComponent[] = [
	{ component: { name: "esp_wifi", version: "5.1.2", cpe: "cpe:2.3:a" }, reason: "cpe-only" },
	{ component: { name: "blob", version: "1.0" }, reason: "no-identifier" },
]

test("report with matches is verdict-clean (self-checked by verdictScan)", () => {
	const report = formatCveScanReport({
		findings: [
			{ match: mbed, applicability: assessApplicability({ codeSymbol: "mbedtls_ssl_handshake" }, { symbols: "main" }) },
		],
		skipped,
		queriedCount: 3,
		asOf: "2026-06-24",
	})
	assert.equal(isVerdictClean(report), true, `report tripped verdictScan:\n${report}`)
	assert.match(report, /OSV reports/)
	assert.match(report, /as of 2026-06-24/)
	assert.match(report, /Coverage: 3 queryable · 1 cpe-only/)
})

test("each applicability branch keeps the report verdict-clean", () => {
	for (const ev of [
		{ symbols: "main" }, // not-linked
		{ symbols: "mbedtls_ssl_handshake" }, // linked (weak)
		{ dotConfig: "CONFIG_MBEDTLS_X=n" }, // config-gated-out (with a gateSymbol below)
		{}, // unknown
	]) {
		const report = formatCveScanReport({
			findings: [
				{
					match: mbed,
					applicability: assessApplicability(
						{ gateSymbol: "CONFIG_MBEDTLS_X", codeSymbol: "mbedtls_ssl_handshake" },
						ev,
					),
				},
			],
			skipped: [],
			queriedCount: 1,
			asOf: "2026-06-24",
		})
		assert.equal(isVerdictClean(report), true, `branch tripped verdictScan:\n${report}`)
	}
})

test("no-match report is verdict-clean and does NOT read as 'clean'", () => {
	const report = formatCveScanReport({ findings: [], skipped, queriedCount: 5, asOf: "2026-06-24" })
	assert.equal(isVerdictClean(report), true, `no-match report tripped verdictScan:\n${report}`)
	assert.doesNotMatch(report, /\bclean\b/i)
	assert.match(report, /not a complete check/)
})

test("EDGE: component names containing verdict words ('libfixed', 'clearwater') stay verdict-clean", () => {
	const tricky: OsvMatch = {
		component: { name: "libfixed-clearwater-affected", version: "1.0", purl: "pkg:generic/libfixed@1.0" },
		vulnIds: ["CVE-2025-0001"],
	}
	const report = formatCveScanReport({
		findings: [{ match: tricky, applicability: assessApplicability(undefined, {}) }],
		skipped: [],
		queriedCount: 1,
		asOf: "2026-06-24",
	})
	assert.equal(isVerdictClean(report), true, `verdict-word component name tripped the scanner:\n${report}`)
})

test("coverage line is honest about cpe-only + no-identifier gaps", () => {
	const report = formatCveScanReport({ findings: [], skipped, queriedCount: 5, asOf: "2026-06-24" })
	assert.match(report, /1 cpe-only \(not OSV-queryable\)/)
	assert.match(report, /1 with no identifier/)
})
