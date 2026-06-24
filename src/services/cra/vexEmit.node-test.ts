import assert from "node:assert/strict"
import { test } from "node:test"
import { isVerdictClean } from "../knowledge/honesty/verdictScan"
import { buildVex, emitVexJson, VexAttestationError, type VexInput } from "./vexEmit"

const base: VexInput = {
	author: "Acme Robotics GmbH",
	product: "pkg:github/acme/firmware@1.2.0",
	timestamp: "2026-06-24T10:00:00Z",
	attested: true,
	statements: [{ vulnId: "CVE-2024-23170", status: "fixed", notes: "bumped mbedtls to 3.5.2" }],
}

test("HARD GATE: unattested → throws, no VEX emitted (red-team #1)", () => {
	assert.throws(() => buildVex({ ...base, attested: false }), VexAttestationError)
})

test("not_affected without justification → throws (OpenVEX rule)", () => {
	assert.throws(() => buildVex({ ...base, statements: [{ vulnId: "CVE-1", status: "not_affected" }] }), VexAttestationError)
})

test("attested: author = manufacturer, tooling = Adsum (not the asserter)", () => {
	const doc = buildVex(base)
	assert.equal(doc.author, "Acme Robotics GmbH")
	assert.equal(doc.role, "Manufacturer")
	assert.match(doc.tooling, /Adsum/)
	assert.notEqual(doc.author, doc.tooling)
})

test("statements carry vuln + product + status (+ justification for not_affected)", () => {
	const doc = buildVex({
		...base,
		statements: [
			{ vulnId: "CVE-2", status: "not_affected", justification: "vulnerable_code_not_present" },
			{ vulnId: "CVE-3", status: "fixed" },
		],
	})
	assert.equal(doc.statements[0].justification, "vulnerable_code_not_present")
	assert.equal(doc.statements[0].products[0]["@id"], base.product)
	assert.equal(doc.statements[1].status, "fixed")
})

test("emitted vex.json passes verdictScan in VEX mode, but the SAME status is banned in prose mode", () => {
	const json = emitVexJson(base) // contains "status": "fixed"
	assert.equal(isVerdictClean(json, { mode: "vex" }), true, `vex.json tripped vex-mode scan:\n${json}`)
	assert.equal(isVerdictClean(json, { mode: "prose" }), false) // the status would be a banned verdict in prose
})

test("a smuggled non-status verdict is banned even in VEX mode", () => {
	const json = emitVexJson({ ...base, statements: [{ vulnId: "CVE-9", status: "fixed", notes: "now compliant" }] })
	assert.equal(isVerdictClean(json, { mode: "vex" }), false) // "compliant" is not a VEX status token → still caught
})
