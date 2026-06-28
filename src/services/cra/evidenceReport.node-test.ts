import assert from "node:assert/strict"
import { test } from "node:test"
import { isVerdictClean } from "../knowledge/honesty/verdictScan"
import { assessApplicability } from "./applicability"
import type { EuvdRecord } from "./euvdFetcher"
import { type CveScanJson, formatCveScanJson, formatCveScanReport } from "./evidenceReport"
import type { OsvMatch, SkippedComponent } from "./osvMatch"

const mbed: OsvMatch = {
	component: { name: "mbedtls", version: "3.5.0", purl: "pkg:github/Mbed-TLS/mbedtls@3.5.0" },
	vulnIds: ["CVE-2024-23170", "GHSA-aaaa-bbbb-cccc"],
}
const skipped: SkippedComponent[] = [
	{ component: { name: "esp_wifi", version: "5.1.2", cpe: "cpe:2.3:a" }, reason: "cpe-only" },
	{ component: { name: "blob", version: "1.0" }, reason: "no-id" },
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

test("EUVD confirmation surfaces in report + json (id + EPSS + KEV) and stays verdict-clean", () => {
	const euvd = new Map<string, EuvdRecord>([
		[
			"CVE-2024-23170",
			{
				euvdId: "EUVD-2026-35353",
				cveId: "CVE-2024-23170",
				baseScore: 7.6,
				epss: 0.17,
				exploited: true,
				references: ["https://euvd.enisa.europa.eu"],
			},
		],
	])
	const input = {
		findings: [
			{ match: mbed, applicability: assessApplicability({ codeSymbol: "mbedtls_ssl_handshake" }, { symbols: "main" }) },
		],
		skipped,
		queriedCount: 3,
		asOf: "2026-06-24",
		euvd,
	}
	const report = formatCveScanReport(input)
	assert.match(report, /EU Vulnerability Database: EUVD-2026-35353/)
	assert.match(report, /EPSS 17%/)
	assert.match(report, /actively exploited \(KEV\)/)
	// EPSS/KEV are sourced facts, not a verdict — must not trip the honesty scanner.
	assert.equal(isVerdictClean(report), true, `EUVD line tripped verdictScan:\n${report}`)
	const json = JSON.parse(formatCveScanJson(input)) as CveScanJson
	const adv = json.findings[0].advisories.find((a) => a.id === "CVE-2024-23170")
	assert.equal(adv?.euvd?.id, "EUVD-2026-35353")
	assert.equal(adv?.euvd?.exploited, true)
	assert.equal(adv?.euvd?.epss, 0.17)
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

// ── §7 JSON evidence artifact (formatCveScanJson) ────────────────────────────────────────────────────────────
test("JSON artifact mirrors the markdown findings (same input, same data)", () => {
	const input = {
		findings: [{ match: mbed, applicability: assessApplicability(undefined, {}) }],
		skipped,
		queriedCount: 3,
		asOf: "2026-06-24",
	}
	const doc = JSON.parse(formatCveScanJson(input)) as CveScanJson
	assert.equal(doc.schema, "adsum.cve-scan/1")
	assert.equal(doc.source, "OSV")
	assert.equal(doc.asOf, "2026-06-24")
	assert.equal(doc.findings.length, 1)
	assert.equal(doc.findings[0].component, "mbedtls")
	assert.deepEqual(
		doc.findings[0].advisories.map((a) => a.id),
		["CVE-2024-23170", "GHSA-aaaa-bbbb-cccc"],
	)
	assert.match(doc.findings[0].advisories[0].url, /osv\.dev\/vulnerability\/CVE-2024-23170/)
	assert.equal(doc.findings[0].applicability.signal, "unknown")
	assert.match(doc.findings[0].applicability.note, /verify/)
})

test("JSON coverage mirrors the breakdown (queryable + byDropReason), never a bare count", () => {
	const doc = JSON.parse(formatCveScanJson({ findings: [], skipped, queriedCount: 5, asOf: "2026-06-24" })) as CveScanJson
	assert.equal(doc.coverage.queryable, 5)
	assert.deepEqual(doc.coverage.byDropReason, { "cpe-only": 1, "no-id": 1 })
	assert.deepEqual(
		doc.skipped.map((s) => `${s.component}:${s.reason}`),
		["esp_wifi:cpe-only", "blob:no-id"],
	)
})

test("JSON artifact is verdict-clean (no conformity verdict smuggled into a structured field)", () => {
	const json = formatCveScanJson({
		findings: [{ match: mbed, applicability: assessApplicability({ gateSymbol: "CONFIG_X" }, { dotConfig: "CONFIG_X=n" }) }],
		skipped,
		queriedCount: 3,
		asOf: "2026-06-24",
	})
	assert.equal(isVerdictClean(json), true, `JSON artifact tripped verdictScan:\n${json}`)
})

test("JSON no-match case: empty findings, but coverage still honest (not 'clean')", () => {
	const doc = JSON.parse(formatCveScanJson({ findings: [], skipped, queriedCount: 5, asOf: "2026-06-24" })) as CveScanJson
	assert.equal(doc.findings.length, 0)
	assert.match(doc.provenance, /Partial coverage/)
	assert.equal(isVerdictClean(JSON.stringify(doc)), true)
})
