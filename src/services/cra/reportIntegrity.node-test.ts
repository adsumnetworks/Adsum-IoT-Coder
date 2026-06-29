/**
 * Tests for the CRA readiness-report integrity guard (F1). node:test, runs via `npm run test:cve` (ts-node)
 * on the default toolchain. Pure cross-check only — no disk (the fs wrapper is exercised in integration).
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import {
	checkReadinessReportIntegrity,
	detectSbomTool,
	extractClaimedPackageCount,
	looksLikeCraReportContent,
	looksLikeInlineCraReport,
	looksLikeReadinessReport,
} from "./reportIntegrity"
import { normalizeSbom } from "./sbomNormalize"

// A real-shaped west ncs-sbom SPDX: one unidentified package, no PURL (the toothless-CVE case). total = 1.
const NCS_SBOM = `SPDXVersion: SPDX-2.2
DataLicense: CC0-1.0
CreatorComment: <text>Generated with west-ncs-sbom.</text>

PackageName: unknown-package
PackageVersion: NoneVersion
PackageDownloadLocation: NONE
`

// A small package-level SPDX with 2 packages (one PURL'd).
const PKG_SBOM = `SPDXVersion: SPDX-2.3
DataLicense: CC0-1.0
Creator: Tool: west spdx

PackageName: my_app
PackageVersion: 0.1.0

PackageName: mbedtls
PackageVersion: 3.6.4
ExternalRef: PACKAGE-MANAGER purl pkg:github/Mbed-TLS/mbedtls@3.6.4
`

const DISCLAIMER = "Readiness aid — NOT a conformity assessment."
const HEDGED_DATED = "Verify against your notified body. CVE scan: OSV, as of 2026-06-27."
// The header primitives the structure scan now requires on every readiness report (parity, 2906i): the canonical
// H1, the at-a-glance counts line, and the Adsum attribution. Prepend to a body to make a structurally-complete report.
const HEADER =
	"# CRA SBOM & Fix — my_app\n" +
	"> SDK: NCS 3.2.1 · Generated: 2026-06-27 by Adsum IoT Coder (CRA SBOM & Fix) · Method: west spdx\n" +
	"> **At a glance** — 2 components · 0 CVEs found · 0 likely not reachable · 0 gaps.\n"

test("detectSbomTool: reads the generator from prose or an SPDX creator field", () => {
	assert.equal(detectSbomTool("generated via west spdx from build"), "west spdx")
	assert.equal(detectSbomTool("Generated with west-ncs-sbom."), "west ncs-sbom")
	assert.equal(detectSbomTool("esp-idf-sbom create ..."), "esp-idf-sbom")
	assert.equal(detectSbomTool("no tool named here"), null)
})

test("extractClaimedPackageCount: pulls the SBOM-summary package count", () => {
	assert.equal(extractClaimedPackageCount("| Total packages | 91 |"), 91)
	assert.equal(extractClaimedPackageCount("Total packages: 2"), 2)
	assert.equal(extractClaimedPackageCount("no count stated"), null)
})

test("looksLikeReadinessReport: markdown + disclaimer + SBOM mention", () => {
	assert.equal(looksLikeReadinessReport("/p/compliance/CRA_READINESS.md", `${DISCLAIMER}\n## SBOM`), true)
	assert.equal(looksLikeReadinessReport("/p/compliance/sbom/app.spdx", `${DISCLAIMER}\n## SBOM`), false) // not .md
	assert.equal(looksLikeReadinessReport("/p/notes.md", "just some notes"), false) // no disclaimer
})

test("looksLikeReadinessReport: a RETITLED, disclaimer-stripped report still classifies (2806c drift-proofing)", () => {
	// 2806c retitled to "CRA Readiness Assessment" and dropped "not a conformity assessment", so the canonical
	// signal missed it and the guard never ran. Re-detected by location + consolidated shape (SBOM + posture/Annex).
	const retitled =
		"# CRA Readiness Assessment — peripheral_uart\n## SBOM\n## Build-Time Posture\nCONFIG_BT_SMP=y\nAnnex I Part I"
	assert.equal(looksLikeReadinessReport("/p/compliance/cra-readiness-2026-06-28.md", retitled), true)
	// but the CVE-scan-only artifact (no posture/Annex section) must NOT be mistaken for the readiness report
	assert.equal(
		looksLikeReadinessReport("/p/compliance/cve-scan-2026-06-28.md", "## CVE scan — OSV\nmatches for your SBOM"),
		false,
	)
})

test("looksLikeInlineCraReport: the write-seam seatbelt blocks an inline report, passes a thin pointer (2806e)", () => {
	// 2806e pasted the whole report into attempt_completion (no write_to_file) → unguarded. The seatbelt detects
	// the report body (title/disclaimer + tables/sections/CONFIG_) and blocks it.
	const inlineReport =
		`# CRA SBOM & Fix — peripheral_uart\n${DISCLAIMER}\n\nProduct type: assumed · Binding date: 11 Dec 2027.\n\n` +
		"## 1. SBOM\nGenerated via west spdx (SPDX 2.3) from the real build — 44 modules-deps packages; 3 carry CPE.\n\n" +
		"## 2. Posture preview\n| Check | Your build shows | You verify |\n" +
		"| Secure boot | CONFIG_BOOTLOADER_MCUBOOT not set | verify the bootloader child image actually built |\n" +
		"| BLE pairing | CONFIG_BT_SMP=y present; CONFIG_BT_SMP_SC_ONLY not set | confirm SC-only in production |\n" +
		"| Memory protection | CONFIG_ARM_MPU=y present; CONFIG_STACK_SENTINEL not present | verify fits threat model |\n\n" +
		"## 3. Advisories\nNo bundled advisories for NCS v3.2.1 as of 2026-06-18; check live (EUVD, Nordic PSIRT).\n\n" +
		"## 4. Worth doing now\nThread A — 3 mbed TLS CVEs to review. Thread B — secure boot, APPROTECT, PSA ITS."
	assert.ok(inlineReport.length > 400)
	assert.equal(looksLikeInlineCraReport(inlineReport), true)
	// a correct THIN completion (counts + legend + pointer + offer) is short and structureless → passes.
	const thin =
		"CRA preview complete — 44 components · 6 CVEs · 3 likely not reachable · 6 gaps. Each line is build " +
		"evidence — present/not set + what to verify, not a pass/fail verdict. Full report written to " +
		"/tmp/adsum-cra/compliance/CRA_READINESS.md. Next: assess the 3 mbed TLS CVEs?"
	assert.equal(looksLikeInlineCraReport(thin), false)
	// a non-CRA completion is never affected.
	assert.equal(looksLikeInlineCraReport("Fixed the BLE disconnect bug; all tests pass. ".repeat(20)), false)
})

test("looksLikeCraReportContent: the completion seatbelt also catches the posture preview dumped in a say (2906c)", () => {
	// 2906c ran out of context and dumped the full posture preview into a chat `say` (not the attempt_completion
	// result), then completed thin. This broader detector fires on that posture content so the host can refuse the
	// completion when no report was written. It catches the secure-by-design preview even without an SBOM table.
	const posturePreview =
		"## Secure-by-Design Checks — nRF52840 (Cortex-M4, no TrustZone)\n" +
		"Readiness aid — NOT a conformity assessment. Each check is evidence-mode: the literal symbol from your\n" +
		"merged .config, neutrally reported — the conclusion is yours.\n\n" +
		"**1 · Secure boot** — your build shows: CONFIG_BOOTLOADER_MCUBOOT is not set; CONFIG_SECURE_BOOT is not set;\n" +
		"CONFIG_NCS_MCUBOOT_IN_BUILD is not set. You verify: enable MCUboot at the sysbuild level if you intend it.\n" +
		"**3 · BLE pairing** — your build shows: CONFIG_BT_SMP=y; CONFIG_BT_SMP_SC_PAIR_ONLY=y; CONFIG_BT_BONDABLE=y;\n" +
		"CONFIG_BT_SMP_ENFORCE_MITM=y. You verify: confirm no Just-Works fallback in production.\n" +
		"**5 · Crypto** — your build shows: CONFIG_NRF_SECURITY=y; CONFIG_PSA_CRYPTO_C=y; CONFIG_TRUSTED_STORAGE is\n" +
		"not set. You verify: keys likely use raw NVS/flash — consider PSA ITS.\n"
	assert.ok(posturePreview.length > 400)
	assert.equal(looksLikeCraReportContent(posturePreview), true)
	// the thin pointer still passes (no report body) — a correct completion isn't blocked.
	const thin =
		"CRA preview complete — 44 components · 6 CVEs · 3 likely not reachable. Each line is build evidence, not a " +
		"verdict. Full report written to /tmp/adsum-cra/compliance/cra-2026-06-29/CRA_READINESS.md. Next: assess the CVEs?"
	assert.equal(looksLikeCraReportContent(thin), false)
	// and a normal non-CRA completion is untouched.
	assert.equal(looksLikeCraReportContent("Refactored the UART driver; all tests pass. ".repeat(20)), false)
})

test("blocks the 2706b fabrication: wrong tool + inflated package count", () => {
	const report = `# CRA SBOM & Fix\n${DISCLAIMER}\n${HEDGED_DATED}\n## SBOM\nGenerated via west spdx.\n| Total packages | 91 |\n`
	const issues = checkReadinessReportIntegrity({
		reportText: report,
		sbom: normalizeSbom(NCS_SBOM), // real total = 1
		sbomText: NCS_SBOM, // real tool = west ncs-sbom
	})
	const kinds = issues.map((i) => i.kind)
	assert.ok(kinds.includes("sbom-tool"), `expected sbom-tool issue, got ${kinds.join(",")}`)
	assert.ok(kinds.includes("package-count"), `expected package-count issue, got ${kinds.join(",")}`)
})

test("blocks 0-queryable CVE framed as a clean result without the coverage caveat", () => {
	const report = `# CRA\n${DISCLAIMER}\n${HEDGED_DATED}\n## SBOM (west spdx)\nNo CVEs detected in the SBOM packages.\n`
	const issues = checkReadinessReportIntegrity({ reportText: report, sbomText: PKG_SBOM, cveQueryable: 0 })
	assert.ok(
		issues.some((i) => i.kind === "cve-framing"),
		"expected cve-framing issue",
	)
})

test("passes an honest 0-queryable report (coverage caveat present)", () => {
	const report = `${HEADER}${DISCLAIMER}\n${HEDGED_DATED}\n## SBOM\nGenerated via west spdx.\n| Total packages | 2 |\nCVE scan: 0 queryable, 1 unidentified — not a complete check. No OSV matches.\n`
	const issues = checkReadinessReportIntegrity({
		reportText: report,
		sbom: normalizeSbom(PKG_SBOM), // total = 2 (matches the report)
		sbomText: PKG_SBOM, // tool = west spdx (matches the report)
		cveQueryable: 0,
	})
	assert.deepEqual(issues, [], `expected no issues, got ${JSON.stringify(issues)}`)
})

// Parity (2906i): the ESP run shipped a structurally-complete-looking report that had been RETITLED, with no
// at-a-glance line and no attribution — the old checks (disclaimer/hedged/dated) all passed, so it diverged from
// every nRF report. These assert the structure scan now enforces the canonical header on BOTH platforms.
test("parity: blocks a RETITLED report (canonical H1 missing) even with the disclaimer present", () => {
	// The exact ESP-2906i shape: a different H1, disclaimer phrase still present, hedged + dated.
	const report =
		`# Bluedroid_Beacon — CRA Secure-by-Design Preview\n${DISCLAIMER}\n${HEDGED_DATED}\n` +
		"> **At a glance** — 172 components · 4 CVEs · 0 not reachable · 2 gaps.\n" +
		"> Generated: 2026-06-29 by Adsum IoT Coder (CRA SBOM & Fix)\n## SBOM\n"
	const issues = checkReadinessReportIntegrity({ reportText: report })
	assert.ok(
		issues.some((i) => i.kind === "missing-canonical-title"),
		`expected missing-canonical-title, got ${issues.map((i) => i.kind).join(",")}`,
	)
})

test("parity: blocks a report missing the at-a-glance counts line and the Adsum attribution", () => {
	const report = `# CRA SBOM & Fix — my_app\n${DISCLAIMER}\n${HEDGED_DATED}\n## SBOM\nGenerated via west spdx.\n`
	const kinds = checkReadinessReportIntegrity({ reportText: report }).map((i) => i.kind)
	assert.ok(kinds.includes("missing-at-a-glance"), `expected missing-at-a-glance, got ${kinds.join(",")}`)
	assert.ok(kinds.includes("missing-attribution"), `expected missing-attribution, got ${kinds.join(",")}`)
	// the canonical title IS present here → must not be flagged
	assert.ok(!kinds.includes("missing-canonical-title"), "canonical title present → not flagged")
})

test("parity: a fully canonical header passes all structure checks", () => {
	const report = `${HEADER}${DISCLAIMER}\n${HEDGED_DATED}\n## SBOM\nGenerated via west spdx.\n`
	const kinds = checkReadinessReportIntegrity({ reportText: report }).map((i) => i.kind)
	for (const k of ["missing-canonical-title", "missing-at-a-glance", "missing-attribution"]) {
		assert.ok(!kinds.includes(k), `canonical report should not be flagged ${k}, got ${kinds.join(",")}`)
	}
})

test("does NOT flag a package count that matches the SBOM", () => {
	const report = `# CRA\n${DISCLAIMER}\n${HEDGED_DATED}\nGenerated with west-ncs-sbom.\n| Total packages | 1 |\n`
	const issues = checkReadinessReportIntegrity({ reportText: report, sbom: normalizeSbom(NCS_SBOM), sbomText: NCS_SBOM })
	assert.ok(!issues.some((i) => i.kind === "package-count" || i.kind === "sbom-tool"))
})

// F12 — harden against the 2706f regressions.
test("F12: blocks a verdict-glyph / verdict-word posture table", () => {
	const report = `# CRA\n${DISCLAIMER}\n${HEDGED_DATED}\n| Secure boot | CONFIG_BOOTLOADER_MCUBOOT=y | ✅ Enabled |\n`
	const issues = checkReadinessReportIntegrity({ reportText: report })
	assert.ok(
		issues.some((i) => i.kind === "verdict-leak"),
		`expected verdict-leak, got ${issues.map((i) => i.kind).join(",")}`,
	)
})

test("F12: blocks a CVE id the scan did not produce (fabricated)", () => {
	const report = `# CRA\n${DISCLAIMER}\n${HEDGED_DATED}\nThe scan found CVE-2024-49010 on zephyr/docs.\n`
	const issues = checkReadinessReportIntegrity({ reportText: report, scannedCveIds: [] })
	assert.ok(
		issues.some((i) => i.kind === "cve-fabricated"),
		"expected cve-fabricated",
	)
})

test("F12: allows a CVE id that IS in the scan results", () => {
	const report = `# CRA\n${DISCLAIMER}\n${HEDGED_DATED}\nScan found CVE-2024-45491 in libexpat.\n`
	const issues = checkReadinessReportIntegrity({ reportText: report, scannedCveIds: ["CVE-2024-45491"] })
	assert.ok(!issues.some((i) => i.kind === "cve-fabricated"))
})

test("T2b: blocks a report that DROPS a version-matched scan finding (under-reporting)", () => {
	// The scan matched two CVEs; the report mentions only one → the other was silently dropped.
	const report = `# CRA\n${DISCLAIMER}\n${HEDGED_DATED}\nScan found CVE-2024-45491 in libexpat.\n`
	const issues = checkReadinessReportIntegrity({
		reportText: report,
		scannedCveIds: ["CVE-2024-45491", "CVE-2025-10456"],
		matchedCveIds: ["CVE-2024-45491", "CVE-2025-10456"],
	})
	assert.ok(
		issues.some((i) => i.kind === "cve-underreported" && i.detail.includes("CVE-2025-10456")),
		`expected cve-underreported naming the dropped id, got ${issues.map((i) => i.kind).join(",")}`,
	)
})

test("T2b: a report that lists every matched finding is NOT flagged; EUVD candidates never trigger under-report", () => {
	const report = `# CRA\n${DISCLAIMER}\n${HEDGED_DATED}\nFindings: CVE-2024-45491 and CVE-2025-10456 — both to verify.\n`
	const issues = checkReadinessReportIntegrity({
		reportText: report,
		// scannedCveIds is the superset (incl. a capped EUVD candidate the report need not list); matched is the must-list set.
		scannedCveIds: ["CVE-2024-45491", "CVE-2025-10456", "CVE-2099-9999"],
		matchedCveIds: ["CVE-2024-45491", "CVE-2025-10456"],
	})
	assert.ok(!issues.some((i) => i.kind === "cve-underreported"), "matched findings all listed → no under-report")
})
