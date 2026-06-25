/**
 * Tests for the curated advisory-hint resolver. The honesty invariant: no unverified exclusion can ship.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { ADVISORY_HINTS, resolveAdvisoryHint } from "./advisoryHints"

test("seed map is empty (no speculative CVE→Kconfig mappings ship)", () => {
	assert.equal(Object.keys(ADVISORY_HINTS).length, 0)
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
