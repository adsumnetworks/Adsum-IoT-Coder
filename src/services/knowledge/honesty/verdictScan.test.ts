import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { isVerdictClean, scanForVerdictLeaks } from "./verdictScan"

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
	]
	for (const [name, sample] of clean) {
		test(name, () => {
			const found = scanForVerdictLeaks(sample)
			assert.equal(found.length, 0, `false positive in: ${sample}\n got: ${JSON.stringify(found)}`)
		})
	}
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
