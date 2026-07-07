import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { findCraOptionViolations } from "./craAskGuards"

/**
 * CRA resting-ask option guards — the exit/handback shapes a CRA ask must never offer.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/task/tools/handlers/craAskGuards.test.ts
 */
describe("findCraOptionViolations — options that MUST be rejected", () => {
	const banned: Array<[string, string]> = [
		// The 0707 sample run's pause option (clicking it ended the session):
		["pause: continue later", "I'll continue later"],
		["pause: save & come back", "Save & come back later"],
		// The 0707 open-project run's two dead-enders (paraphrased past the literal list — the reason
		// the structural handback check exists):
		["handback: review myself", "I'll review the report myself"],
		["handback: continue from the report", "I'll continue from the report"],
		// Terminal shapes:
		["terminal: I'm done", "I'll review this offline — I'm done"],
		["terminal: that's all", "That's all for now"],
		["terminal: wrap up", "Wrap up"],
		// More handback phrasings the model could reach for next:
		["handback: take it from here", "I'll take it from here"],
		["handback: I've got it", "I've got it from here"],
		["handback: leave it with me", "Leave it with me"],
		["handback: let me review", "Let me review the findings first"],
	]
	for (const [name, option] of banned) {
		test(`rejects: ${name}`, () => {
			assert.equal(findCraOptionViolations([option]).length, 1, option)
		})
	}
})

describe("findCraOptionViolations — forward options that MUST pass", () => {
	const clean: string[] = [
		// The real run's good options:
		"Triage CVE-2023-52160 — wpa_supplicant / Wi-Fi stack",
		"Start Secure Boot v2 — the root-of-trust gap",
		"Triage the highest-EPSS EUVD lead (CVE-2025-52471 — 74% EPSS)",
		"Draft a VEX for CVE-2023-52160",
		"Re-scan after a change",
		"Review the EUVD leads",
		"Save a copy to my Desktop",
		"Open my project & run it for real",
		// Mentions the dev mid-sentence but the agent is the actor:
		"Re-scan after you change the config",
		// Per-thread decline (not a session exit):
		"Skip this CVE — show me the posture gaps",
	]
	for (const option of clean) {
		test(`passes: ${option}`, () => {
			assert.deepEqual(findCraOptionViolations([option]), [], option)
		})
	}
})
