import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { craScanModeForPath, isVerdictClean, scanForVerdictLeaks } from "./verdictScan"

/**
 * C1/C4 — the CRA honesty scan + the STATIC regression fixtures.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/knowledge/honesty/verdictScan.test.ts
 *
 * Two halves:
 *  - LEAKS: generated-output shapes that MUST be caught (the documented verdict-word failures).
 *  - DISCLAIMERS / EVIDENCE-MODE: legitimate text that MUST NOT trip (negated/meta uses, advisory metadata).
 * (Config-misread + re-offer-after-applied failures are model-behavior — they need the LLM eval harness,
 *  not this static scan; see design/08 §4.)
 */

describe("verdictScan — leaks that MUST be caught", () => {
	const leaks: Array<[string, string]> = [
		["the canonical ✅ FIXED leak", "| Secure boot | ✅ FIXED (2026-06-18) | MCUboot added |"],
		["closing-summary 'Top gap fixed'", "All set — Top gap fixed; you can ship."],
		["'now compliant'", "Your build is now compliant with the CRA."],
		["'gap resolved'", "Nice — that gap resolved after the rebuild."],
		["'vulnerability fixed'", "The vulnerability fixed itself once you bumped cjson."],
		["assertive 'you're certified'", "Great, you're certified for Annex I now."],
		["all-clear verdict", "Good news — you're in the clear on secure boot."],
		["affected verdict (even negated)", "Don't worry, your build is not affected by CVE-2025-0001."],
		["status cell asserting ✅", "Status: ✅  (secure boot)"],
		// MF3a additions — shapes the verification proved were missed:
		["bare ✅ as a table cell value", "| Secure boot | ✅ | MCUboot present |"],
		["PASS grade", "Secure boot: PASS"],
		["FAIL grade in a cell", "| APPROTECT | FAIL |"],
		["'gap remediated' done-word", "Good — that gap remediated in the rebuild."],
		["passive 'has been mitigated'", "The CVE has been mitigated."],
		["paraphrased 'satisfies the requirement'", "Your build satisfies the requirement for secure boot."],
		["clearance 'all gaps closed'", "Nice — all gaps closed."],
		["clearance 'no gaps remain'", "no gaps remain on this build."],
		["'ready to ship'", "You're ready to ship."],
		[
			"per-clause: meta-clause must not shield the verdict",
			"I won't claim more than I see, but your build is now compliant.",
		],
		// run-#3 review — the "✅ Built & verified" handoff overstatement (build ≠ verification) the scanner missed:
		["'✅ Built & verified' bolded status", "**Status:** ✅ **Built & verified** — build_5340 produced the mcuboot image"],
		["bare '✅ verified' status", "Secure boot: ✅ verified"],
		["'✅ built' done-marker", "MCUboot: ✅ built"],
		// run-#4/#5 review — status glyph as a bullet/list marker (the shape 2306d/2306e produced + the scanner missed):
		["bullet ✅ status marker", "- ✅ MCUboot child image built (`mcuboot/` sub-directory — 32 KB FLASH)"],
		["bullet ⚠️ status marker", "- ⚠️ Default debug signing key — swap before production"],
		["bare ✅ at line start", "✅ MCUboot child image built"],
		// run-#7 (2406b) — the real-project Annex-I "compliance checklist" collapse (the worst leak of the
		// series): ✅ MET / ✅ READY / ✅ ENABLED / ✅ GOOD cells, a ⚠ heading, and the verdict carried into the
		// machine-readable JSON deliverable. The bit now shows this exact shape as forbidden; the scanner catches it.
		["✅ MET on an Annex requirement row", "| 2(1) Security by design | ✅ MET | no unmitigated HIGH/CRITICAL |"],
		["✅ READY top-line readiness verdict", "| CRA Readiness | ✅ READY | all Annex I mandatory requirements met |"],
		["✅ ENABLED posture cell", "| Secure Boot | ✅ ENABLED | MCUboot with signature validation |"],
		["✅ GOOD posture cell", "| SBOM Completeness | ✅ GOOD | SPDX 2.3 for all 3 images |"],
		["⚠ glyph opening a heading", "### ⚠️ MCUMGR UART SMP Transport — No Encryption"],
		["JSON readiness verdict value", '"cra_readiness": "READY — all Annex I mandatory requirements met"'],
		["JSON secure_boot verdict value", '"secure_boot": "ENABLED"'],
		// run-#8 (2406c) — the worst deliverable: a numeric compliance scorecard + "non-compliant" + a FABRICATED
		// CRA article sub-clause. None of these were caught before; all three are now regression-pinned.
		["'non-compliant' verdict", "Under the CRA the product is non-compliant."],
		["'non compliant' (space)", "This makes the build non compliant for the EU market."],
		["'noncompliant' (no separator)", "The device is noncompliant."],
		["numeric grade cell (N/10)", "| Firmware Update | 0/10 |"],
		["aggregate readiness score", "Aggregate CRA Readiness 5.7/10 — two fixes raise it."],
		["'out of 10' grade", "Secure boot scores 7 out of 10."],
		["fabricated CRA article sub-clause", "Vulnerabilities cannot be patched under CRA Article 3(8)."],
	]
	for (const [name, sample] of leaks) {
		test(name, () => {
			const found = scanForVerdictLeaks(sample)
			assert.ok(found.length >= 1, `expected a leak in: ${sample}\n got: ${JSON.stringify(found)}`)
		})
	}
})

describe("verdictScan — disclaimers / evidence-mode that MUST NOT trip", () => {
	const clean: Array<[string, string]> = [
		[
			"the report disclaimer",
			"> Readiness aid — NOT a conformity assessment, NOT legal advice. A ✅ means configured/present, never compliant/correct/done.",
		],
		["the 'never tell you clear' limit", "I will never tell you you're clear, and I won't say you're compliant."],
		[
			"neutral non-gap evidence",
			"CONFIG_BOOTLOADER_MCUBOOT: not present in this merged .config — verify whether your design intends it.",
		],
		["advisory metadata 'affected versions'", "CVE-2025-0001 — affected versions: 1.0.0–1.2.3; remediated in 1.2.4."],
		[
			"a curated requirement row",
			"Boot only verified firmware — CRA Annex I Part I. Your build shows CONFIG_SECURE_BOOT=y is present.",
		],
		[
			"a 'never resolved by a build' rule",
			"A clean build does not mean a gap is resolved — it is started, build/flash/verify.",
		],
		["honesty rule quoting the bans", 'Never say "compliant", "certified", "passes", "affected".'],
		// MF3a — advisory metadata about a CVE's scope is NOT a verdict about the user's build:
		["advisory 'builds … are affected'", "Builds before 1.2.4 are affected; update to 1.2.4."],
		["advisory 'which versions are affected'", "Check which versions are affected by this CVE."],
		["meta-clause + meta-clause (both shielded)", "I will never tell you you're clear, and I won't say you're compliant."],
		// run-#3 review — the HONEST handoff phrasing must stay clean (legitimately uses build/verify):
		[
			"honest handoff 'changed — build, flash, verify'",
			"Secure boot: changed — build, flash, verify on hardware; a clean build is not verification.",
		],
		["dev-as-hero verify offer", "Want me to start MCUboot so YOU can build, flash, and verify it?"],
		// run-#4/#5 — the disclaimer's mid-sentence ✅ (preceded by "A ") is NOT a status marker → must stay clean:
		["disclaimer mid-sentence ✅ stays clean", "A ✅ means configured/present in this build — never a status verdict."],
		// run-#7 (2406b) — the HONEST evidence-mode JSON value + a glyph-free heading must NOT trip the new rules
		// (json-verdict only fires when the value STARTS with a verdict word; heading-glyph needs a leading glyph):
		[
			"JSON evidence value stays clean",
			'"secure_boot": "CONFIG_BOOTLOADER_MCUBOOT=y present — verify the child image built"',
		],
		["glyph-free heading stays clean", "### Top gap: no in-field firmware update path"],
		// run-#8 carve-outs — the new rules must NOT fire on the bit's own MANDATORY "Article 14" citation, on
		// version numbers / evidence counts (the score-grade rule is anchored to a /10 denominator), or on a meta
		// "never call it non-compliant" clause:
		["curated 'Article 14' stays clean", "Article 14 vulnerability reporting applies since 11 Sep 2026."],
		["skeleton header 'Art. 14' stays clean", "Binding date: Art. 14 since 11 Sep 2026"],
		["version numbers stay clean", "SBOM is SPDX 2.3; the SDK is NCS 3.2.1."],
		["evidence count (3/3) stays clean", "3/3 images present in the build."],
		["meta 'never call it non-compliant' stays clean", "I will never call your build non-compliant."],
	]
	for (const [name, sample] of clean) {
		test(name, () => {
			const found = scanForVerdictLeaks(sample)
			assert.equal(found.length, 0, `false positive in: ${sample}\n got: ${JSON.stringify(found)}`)
		})
	}
})

// Red-team MF (lens honesty-legal): the honesty scanner was asymmetric + leaky on the new VEX/scan shapes —
// it FALSE-NEGATIVED the dishonest done-claims (a `fixed` table cell, "CVE-X fixed after the bump") while it
// false-positived honest evidence-mode applicability text. Fix: (1) cve-state-verdict + vex-token-in-prose
// rules catch the prose done-claims a CVE *id* between subject + verb used to slip; (2) the §8.1 attribution+
// date gate lets the honest "OSV reports CVE-X fixed in 1.2.4, as of D" pass on the SAME verb; (3) mode "vex"
// lets the machine vex.json carry the enumerated status field VALUES while still banning prose verdicts there.
describe("verdictScan — CVE/VEX done-claim leaks that MUST be caught (prose)", () => {
	const leaks: Array<[string, string]> = [
		// the exact red-team false-negatives:
		["VEX `fixed` cell in a report table", "| CVE-2025-0001 | mbedtls@3.5.0 | fixed (in build 5340) |"],
		["CVE id between subject + verb ('fixed after the bump')", "CVE-2025-0001 fixed after the cjson bump"],
		["bare VEX token `not_affected` in prose", "not_affected"],
		["VEX `not_affected` justification row in a report", "| CVE-2025-0001 | mbedtls@3.5.0 | not_affected | CONFIG_X=n |"],
		["copula state-claim 'CVE-X is fixed'", "CVE-2025-0001 is fixed."],
		["copula state-claim 'the vulnerability is fixed'", "The vulnerability is fixed."],
		["'patched' state-claim", "CVE-2025-0001 patched in the rebuild."],
		["'OpenVEX status fixed' prose", "OpenVEX status fixed"],
		// json-vex-status: a VEX status field VALUE smuggled into a prose/markdown file. The machine vex.json
		// carries these legitimately (mode "vex"), but the same `{"status":"fixed"}` pasted into a `*.md` report
		// is a verdict about the dev's build. vex-token-in-prose anchored to a clause/`|` start, so the JSON
		// colon-quote (`: "`) slipped it — this shape closes the gap.
		["json field value 'status: fixed' in prose", '"status": "fixed"'],
		["json field value 'status:fixed' no-space", '"status":"fixed"'],
		["json field value 'status: not_affected'", '"status": "not_affected"'],
		["json field value 'status: affected'", '"status": "affected"'],
		["json field value 'vex_status: fixed'", '"vex_status": "fixed"'],
		["json field value 'determination: remediated'", '"determination": "remediated"'],
		// red-team residual (RT-lens-honesty-legal, run #2): a "clean" verdict about the dev's build is the most
		// natural laundering of a no-findings adjudication. It slipped because "clean" was not in the subject-
		// anchored verdict vocabulary AND because a self-authored verdict can borrow a source noun + date in a
		// SIBLING clause without becoming honest (the verdict clause names no source). All must fire:
		["'your build is clean' verdict", "Your build is clean."],
		["'your build is now clean' verdict", "Your build is now clean."],
		["'the build is clean' verdict", "The build is clean."],
		["bare 'you're clean' verdict", "You're clean."],
		["'the product is clean' verdict", "The product is clean."],
		["'your firmware is clean' verdict", "Scan complete — your firmware is clean."],
		["source+date in a sibling clause can't launder a clean verdict", "OSV, as of 2026-06-23 — your build is now clean."],
	]
	for (const [name, sample] of leaks) {
		test(name, () => {
			const found = scanForVerdictLeaks(sample)
			assert.ok(found.length >= 1, `expected a leak in: ${sample}\n got: ${JSON.stringify(found)}`)
		})
	}
})

describe("verdictScan — attributed-dated CVE evidence that MUST NOT trip (the §8.1 cut, prose)", () => {
	const clean: Array<[string, string]> = [
		// the honest counterpart of each banned verb — sourced AND dated:
		["OSV-attributed dated 'affects'", "OSV reports CVE-2025-0001 affects 1.0.0-1.2.0, as of 2026-06-23."],
		["OSV-attributed dated 'fixed in <ver>'", "OSV reports CVE-2025-0001 fixed in 1.2.4, as of 2026-06-23."],
		["EUVD-attributed dated 'fixed'", "EUVD lists CVE-2025-0001 as fixed in 1.2.4 (as of 2026-06-23)."],
		["advisory-attributed dated", "Per the advisory, CVE-2025-0001 was fixed in 1.2.4 (2026-06-23)."],
		// honest applicability / scope metadata (already clean before — pinned so the new rules can't regress it):
		["honest applicability gate (config-gated out)", "Applicability: config-gated out (CONFIG_MBEDTLS_X=n) — verify."],
		["advisory scope 'affected versions'", "CVE-2025-0001 — affected versions: 1.0.0–1.2.3; remediated in 1.2.4."],
		// json-vex-status MUST NOT fire on an honest EVIDENCE value on a status key (value does not START with a
		// verdict token), nor on a sourced-dated value (the §8.1 attribution+date gate shields it):
		[
			"honest status-key evidence value stays clean",
			'"status": "CONFIG_MBEDTLS_X=n — open the advisory to confirm it applies"',
		],
		["attributed-dated status value stays clean", '"status": "fixed in 1.2.4 per OSV, as of 2026-06-24"'],
		// clean-verdict false-positive guard: the §8.1a coverage caption legitimately says "not evidence your
		// build is clean" (the OPPOSITE of a verdict). It MUST stay clean, as must "clean" used as a build
		// artifact ("a clean build") or quoted in an honesty rule. These pin the discriminator so the new
		// clean-verdict rule can never start eating the honest caption it is supposed to coexist with.
		["§8.1a anti-clean clause stays clean", "that is a limit of our matching, not evidence your build is clean."],
		[
			"full §8.1a coverage caption stays clean",
			"We could query 4 of 7 components against OSV. The other 3 we could not identify for lookup: cpe-only ×2, fork-unresolved ×1 — that is a limit of our matching, not evidence your build is clean. The unidentified components are listed below as unknown (open their advisories).",
		],
		[
			"'a clean build does not mean resolved' honesty rule",
			"A clean build does not mean a gap is resolved — build, flash, verify.",
		],
		[
			"'a clean build is not verification' rule",
			"Secure boot: changed — build, flash, verify; a clean build is not verification.",
		],
		["'clean build' as a build artifact stays clean", "Run a clean build after changing Kconfig."],
	]
	for (const [name, sample] of clean) {
		test(name, () => {
			const found = scanForVerdictLeaks(sample)
			assert.equal(found.length, 0, `false positive in: ${sample}\n got: ${JSON.stringify(found)}`)
		})
	}
})

describe("verdictScan — VEX artifact mode (compliance/vex.json)", () => {
	// In the MACHINE VEX file, the enumerated CycloneDX/OpenVEX status field VALUES are legitimate (the dev's
	// determination, ingested by enterprise scanners). They must NOT trip in mode "vex".
	const okInVex: Array<[string, string]> = [
		["status field value 'fixed'", '"status": "fixed"'],
		["status field value 'not_affected'", '"status": "not_affected"'],
		["status field value 'affected'", '"status": "affected"'],
		["bare enumerated token", "not_affected"],
	]
	for (const [name, sample] of okInVex) {
		test(`allowed in vex mode: ${name}`, () => {
			assert.equal(scanForVerdictLeaks(sample, { mode: "vex" }).length, 0, `vex-mode false positive: ${sample}`)
		})
		test(`STILL banned in prose mode: ${name}`, () => {
			assert.ok(scanForVerdictLeaks(sample).length >= 1, `prose-mode must ban: ${sample}`)
		})
	}
	// The VEX file must NOT be a smuggling channel for a conformity adjudication — prose verdicts stay banned.
	const bannedEvenInVex: Array<[string, string]> = [
		["'now compliant' smuggled into vex", "Your build is now compliant."],
		["glyph verdict smuggled into vex", "| CVE-2025-0001 | ✅ FIXED |"],
		["numeric readiness score smuggled into vex", "Aggregate CRA Readiness 5.7/10 — two fixes raise it."],
	]
	for (const [name, sample] of bannedEvenInVex) {
		test(`banned even in vex mode: ${name}`, () => {
			assert.ok(scanForVerdictLeaks(sample, { mode: "vex" }).length >= 1, `vex mode must still ban: ${sample}`)
		})
	}
	test("craScanModeForPath routes vex.json → vex, reports → prose", () => {
		assert.equal(craScanModeForPath("/proj/compliance/vex.json"), "vex")
		assert.equal(craScanModeForPath("/proj/compliance/openvex.json"), "vex")
		assert.equal(craScanModeForPath("C:\\proj\\compliance\\vex.json"), "vex")
		assert.equal(craScanModeForPath("/proj/compliance/cra-readiness.md"), "prose")
		assert.equal(craScanModeForPath("/proj/compliance/cve-scan-2026-06-23.md"), "prose")
	})
})

describe("verdictScan — API", () => {
	test("isVerdictClean mirrors scan", () => {
		assert.equal(isVerdictClean("evidence-mode: CONFIG_X present — verify"), true)
		assert.equal(isVerdictClean("✅ FIXED"), false)
	})
	test("reports 1-based line numbers", () => {
		const found = scanForVerdictLeaks("line one is fine\nyou're now compliant\nlast line")
		assert.equal(found[0]?.line, 2)
	})
	test("a full evidence-mode report stays clean end-to-end", () => {
		const report = [
			"# CRA SBOM & Fix — central_uart",
			"> Readiness aid — NOT a conformity assessment. A ✅ means configured/present, never compliant/correct/done.",
			"## 2. Posture preview",
			"| Secure boot | Boot only verified firmware — Annex I Part I | CONFIG_BOOTLOADER_MCUBOOT: not present in this merged .config | verify whether you intend MCUboot |",
			"| BLE pairing | Authenticated access — Annex I Part I | CONFIG_BT_SMP=y is present | confirm LE Secure Connections |",
			"## 3. Advisories",
			"No bundled advisories for NCS 3.2.1 as of 2026-06-23; check live.",
		].join("\n")
		assert.deepEqual(scanForVerdictLeaks(report), [])
	})
})
