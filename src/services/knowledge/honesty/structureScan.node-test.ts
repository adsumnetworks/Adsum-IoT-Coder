/**
 * Tests for the honesty STRUCTURE scan (positive-presence). Pairs with verdictScan (negative-absence): a report
 * is honest iff no banned verdict is present AND the required honest primitives are present.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { assessApplicability } from "../../cra/applicability"
import { formatCveScanReport } from "../../cra/evidenceReport"
import type { OsvMatch } from "../../cra/osvMatch"
import { hasHonestStructure, scanForMissingStructure } from "./structureScan"
import { isVerdictClean } from "./verdictScan"

// ── cve-scan profile ─────────────────────────────────────────────────────────────────────────────────────────
test("REAL formatCveScanReport output has the honest structure (formatter regression guard)", () => {
	const match: OsvMatch = {
		component: { name: "mbedtls", version: "3.5.0", purl: "pkg:github/x/y@3.5.0" },
		vulnIds: ["CVE-2024-1"],
	}
	const report = formatCveScanReport({
		findings: [{ match, applicability: assessApplicability(undefined, {}) }],
		skipped: [],
		queriedCount: 1,
		asOf: "2026-06-25",
	})
	assert.deepEqual(scanForMissingStructure(report, "cve-scan"), [])
	assert.equal(hasHonestStructure(report, "cve-scan"), true)
})

test("REAL no-match report still has the honest structure (partial-coverage disclosed)", () => {
	const report = formatCveScanReport({ findings: [], skipped: [], queriedCount: 3, asOf: "2026-06-25" })
	assert.equal(hasHonestStructure(report, "cve-scan"), true)
})

test("cve-scan: dropping the date → attribution-and-date flagged", () => {
	const missing = scanForMissingStructure("Coverage: 3 queryable. Partial coverage; verify each.", "cve-scan")
	assert.deepEqual(
		missing.map((m) => m.id),
		["attribution-and-date"],
	)
})

test("cve-scan: a bare result with no coverage / no hedge → multiple primitives flagged", () => {
	const missing = scanForMissingStructure("OSV reports CVE-2024-1 as of 2026-06-25.", "cve-scan").map((m) => m.id)
	assert.ok(missing.includes("coverage-stated"))
	assert.ok(missing.includes("partial-coverage-disclosed"))
	assert.ok(missing.includes("hedged"))
})

// ── cra-readiness profile (the fix-D omission) ───────────────────────────────────────────────────────────────
test("cra-readiness: a report WITH the disclaimer + hedge + date is structurally honest", () => {
	const report = `# CRA Readiness aid — NOT a conformity assessment

Posture (as of 2026-06-25): CONFIG_X is enabled in your build — verify against the requirement.`
	assert.equal(hasHonestStructure(report, "cra-readiness"), true)
})

test("FIX-D: a report that DROPS the disclaimer is caught by structureScan even when verdict-clean", () => {
	// No banned verdict word → verdictScan passes; but the mandatory disclaimer is gone → structureScan fails.
	const noDisclaimer = `# CRA Readiness Assessment

Posture (as of 2026-06-25): MCUboot is configured — verify on your build.`
	assert.equal(isVerdictClean(noDisclaimer), true, "precondition: no banned verdict present")
	const missing = scanForMissingStructure(noDisclaimer, "cra-readiness").map((m) => m.id)
	assert.deepEqual(missing, ["readiness-disclaimer"])
	assert.equal(hasHonestStructure(noDisclaimer, "cra-readiness"), false)
})

test("cra-readiness: missing hedge + date both flagged", () => {
	const missing = scanForMissingStructure(
		"Readiness aid — NOT a conformity assessment. Secure boot is configured.",
		"cra-readiness",
	).map((m) => m.id)
	assert.ok(missing.includes("hedged"))
	assert.ok(missing.includes("dated-evidence"))
	assert.ok(!missing.includes("readiness-disclaimer"))
})
