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

// ── cra-readiness profile (the fix-D omission + the 2906i parity header) ──────────────────────────────────────
// The header primitives every readiness report must carry: canonical H1, at-a-glance counts, Adsum attribution
// (parity, 2906i — a real ESP run shipped a report that dropped all three but kept the disclaimer).
const CRA_HEADER =
	"# CRA SBOM & Fix — my_app\n" +
	"> Generated: 2026-06-25 by Adsum IoT Coder (CRA SBOM & Fix)\n" +
	"> **At a glance** — 2 components · 0 CVEs · 0 not reachable · 0 gaps.\n"

test("cra-readiness: a canonical report (header + disclaimer + hedge + date) is structurally honest", () => {
	const report =
		`${CRA_HEADER}Readiness aid — NOT a conformity assessment.\n\n` +
		"Posture (as of 2026-06-25): CONFIG_X is enabled in your build — verify against the requirement."
	assert.equal(hasHonestStructure(report, "cra-readiness"), true)
})

test("FIX-D: a report that DROPS the disclaimer is caught by structureScan even when verdict-clean", () => {
	// No banned verdict word → verdictScan passes; but the mandatory disclaimer is gone → structureScan fails.
	// Canonical header otherwise, so the ONLY missing primitive is the disclaimer (keeps the assertion precise).
	const noDisclaimer = `${CRA_HEADER}\nPosture (as of 2026-06-25): MCUboot is configured — verify on your build.`
	assert.equal(isVerdictClean(noDisclaimer), true, "precondition: no banned verdict present")
	const missing = scanForMissingStructure(noDisclaimer, "cra-readiness").map((m) => m.id)
	assert.deepEqual(missing, ["readiness-disclaimer"])
	assert.equal(hasHonestStructure(noDisclaimer, "cra-readiness"), false)
})

test("parity (2906i): a RETITLED report with no at-a-glance / no attribution is caught even WITH the disclaimer", () => {
	// The exact ESP-2906i shape — disclaimer + hedge + date all present (old checks passed), but the H1 was renamed
	// and the at-a-glance + attribution were dropped, so it diverged from every nRF report.
	const espShape =
		"# Bluedroid_Beacon — CRA Secure-by-Design Preview\nReadiness aid — NOT a conformity assessment.\n\n" +
		"Posture (as of 2026-06-29): CONFIG_SECURE_BOOT is not set — verify if you intend hardware secure boot."
	const missing = scanForMissingStructure(espShape, "cra-readiness").map((m) => m.id)
	assert.ok(missing.includes("canonical-title"), `expected canonical-title, got ${missing.join(",")}`)
	assert.ok(missing.includes("at-a-glance"), `expected at-a-glance, got ${missing.join(",")}`)
	assert.ok(missing.includes("attribution"), `expected attribution, got ${missing.join(",")}`)
	assert.ok(!missing.includes("readiness-disclaimer"), "disclaimer present → not flagged")
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
