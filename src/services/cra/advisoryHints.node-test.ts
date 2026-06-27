/**
 * Tests for the curated advisory-hint resolver. The honesty invariant: no unverified exclusion can ship.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { ADVISORY_HINTS, resolveAdvisoryHint } from "./advisoryHints"

test("ships only HARDWARE-VERIFIED entries — the 3 confirmed not-linked exclusions, each provenanced", () => {
	// Curated 2026-06-27 on NCS 3.2.1 / nrf52840dk: each codeSymbol confirmed ABSENT from a real linked image.
	assert.deepEqual(Object.keys(ADVISORY_HINTS).sort(), ["CVE-2025-24912", "CVE-2026-34872", "CVE-2026-34877"])
	for (const hint of Object.values(ADVISORY_HINTS)) {
		assert.ok(/Verified 2026-/.test(hint.verifiedNote), "every entry must cite its hardware verification date")
	}
})

test("SAFETY: PRNG CVEs (CTR_DRBG IS linked, cc_-prefixed) are deliberately NOT mapped — never a false clear", () => {
	// Mapping these would falsely exclude reachable code (the most dangerous error). They MUST resolve to undefined
	// → the engine reports "unknown"/review, not "not reachable".
	for (const id of ["CVE-2026-25835", "CVE-2026-34871", "CVE-2025-66442"]) {
		assert.equal(resolveAdvisoryHint(id, { name: "mbedtls", version: "3.6.5" }), undefined)
	}
})

test("unknown CVE → undefined (engine reports 'unknown', never a fabricated exclusion)", () => {
	assert.equal(resolveAdvisoryHint("CVE-2024-99999", { name: "mbedtls", version: "3.5.0" }), undefined)
})

test("INVARIANT: every entry that IS added must carry a verifiedNote (auditable provenance)", () => {
	for (const [id, hint] of Object.entries(ADVISORY_HINTS)) {
		assert.ok(hint.verifiedNote && hint.verifiedNote.length > 0, `${id} added without a verifiedNote`)
		assert.ok(hint.gateSymbol || hint.codeSymbol, `${id} has neither a gateSymbol nor a codeSymbol`)
	}
})
