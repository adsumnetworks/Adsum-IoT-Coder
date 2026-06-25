/**
 * Tests for the host orchestration. Network, fs, and nm are all injected — no real build/network.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { isVerdictClean } from "../knowledge/honesty/verdictScan"
import type { BuildEvidenceReaders } from "./buildEvidence"
import { type CveScanHostDeps, runCveScanHost } from "./cveScanHost"
import type { HintResolver } from "./scanLoop"

const SBOM = `SPDXVersion: SPDX-2.3

PackageName: mbedtls
PackageVersion: 3.5.0
ExternalRef: PACKAGE-MANAGER purl pkg:github/Mbed-TLS/mbedtls@3.5.0
`

const oneVulnFetcher = async () => JSON.stringify({ results: [{ vulns: [{ id: "CVE-2024-23170" }] }] })

const readersFrom = (files: Record<string, string>, symbols: Record<string, string> = {}): BuildEvidenceReaders => ({
	readText: (p) => files[p.replace(/\\/g, "/")],
	nm: (p) => symbols[p.replace(/\\/g, "/")],
})

const deps = (over: Partial<CveScanHostDeps> = {}): CveScanHostDeps => ({
	fetcher: oneVulnFetcher,
	readers: readersFrom({}),
	asOf: "2026-06-25",
	...over,
})

test("end-to-end from sbomText: scans, returns verdict-clean md + parseable json", async () => {
	const r = await runCveScanHost({ sbomText: SBOM }, deps())
	assert.match(r.report, /CVE-2024-23170/)
	assert.equal(isVerdictClean(r.report), true)
	assert.equal(JSON.parse(r.json).schema, "adsum.cve-scan/1")
	assert.equal(r.findings.length, 1)
})

test("reads the SBOM from sbomPath via the injected reader", async () => {
	const r = await runCveScanHost(
		{ sbomPath: "compliance/sbom/app.spdx" },
		deps({ readers: readersFrom({ "compliance/sbom/app.spdx": SBOM }) }),
	)
	assert.equal(r.findings.length, 1)
})

test("applies build evidence: a config-gated-out CVE becomes an exclusion via the hint resolver", async () => {
	const resolve: HintResolver = (id) => (id === "CVE-2024-23170" ? { gateSymbol: "CONFIG_MBEDTLS_SSL" } : undefined)
	const r = await runCveScanHost(
		{ sbomText: SBOM, buildDir: "build" },
		deps({
			resolveHint: resolve,
			readers: readersFrom({ "build/zephyr/.config": "# CONFIG_MBEDTLS_SSL is not set\n" }),
		}),
	)
	assert.equal(r.findings[0].applicability.signal, "config-gated-out")
	assert.equal(isVerdictClean(r.report), true)
})

test("missing SBOM → throws a clear error (never a false 'no vulnerabilities')", async () => {
	await assert.rejects(() => runCveScanHost({ sbomPath: "nope.spdx" }, deps()), /Could not read the SBOM/)
	await assert.rejects(() => runCveScanHost({}, deps()), /No SBOM provided/)
})

test("empty SBOM → 0 queryable, honest 'not a complete check', never 'clean'", async () => {
	const r = await runCveScanHost({ sbomText: "" }, deps())
	assert.equal(r.queriedCount, 0)
	assert.doesNotMatch(r.report, /\bclean\b/i)
	assert.match(r.report, /not a complete check/)
})
