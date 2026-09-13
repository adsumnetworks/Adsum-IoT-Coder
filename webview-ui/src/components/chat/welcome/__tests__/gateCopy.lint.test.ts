import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * W-22 — the words the gate is not allowed to use.
 *
 * Two of them, for two different reasons.
 *
 * "Pro" — Phase 1 asks for a free account, not for money. Naming a paid tier at a gate that costs
 * nothing is the fastest way to teach a developer to stop reading our gates, and it would be the
 * word they remember when the real ladder arrives.
 *
 * "open source" — the gateway templates are LICENSED SOURCE. Calling them open source anywhere near
 * the request form would be a promise we cannot keep, and the form's own lead says the true thing.
 *
 * A lint and not a review note, because copy drifts one careful edit at a time.
 */

const dir = join(process.cwd(), "src", "components", "chat", "welcome")
const settings = join(process.cwd(), "src", "components", "settings", "sections")

const GATE_FILES = [
	join(dir, "GatePanel.tsx"),
	join(dir, "CellularGroup.tsx"),
	join(dir, "UnlockedCard.tsx"),
	join(dir, "DemoHexCard.tsx"),
	join(dir, "GatewayLadder.tsx"),
	join(dir, "RequestAccessForm.tsx"),
	join(dir, "AccountChip.tsx"),
	join(settings, "AccountSection.tsx"),
	join(process.cwd(), "src", "components", "chat", "KbitLockedRow.tsx"),
]

/** Only the strings a developer can actually read — a comment explaining the rule is not a breach. */
function userVisible(source: string): string {
	return source
		.split("\n")
		.filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
		.join("\n")
}

describe("W-22 the gate's copy lint", () => {
	const files = GATE_FILES.map((f) => [f.split("/").pop() as string, userVisible(readFileSync(f, "utf8"))] as const)

	it("never says Pro — this ladder asks for an account, not for money", () => {
		for (const [name, text] of files) {
			expect(text, `${name} names a paid tier at a free gate`).not.toMatch(/\bPro\b/)
		}
	})

	it("never says open source — these templates are licensed source", () => {
		for (const [name, text] of files) {
			expect(text, `${name} promises open source`).not.toMatch(/open[- ]source/i)
		}
	})

	it("never says free trial, upgrade or unlock for a fee", () => {
		for (const [name, text] of files) {
			expect(text, `${name} implies a paid step`).not.toMatch(/free trial|upgrade now|paid plan|subscription/i)
		}
	})

	it("covers every file in the gate — a new surface cannot escape the lint by being new", () => {
		// The lint is only worth having if it is impossible to add an ungated file to this group.
		const known = new Set(GATE_FILES.map((f) => f.split("/").pop()))
		const suspects = readdirSync(dir).filter(
			(f) =>
				/^(Gate|Account|Unlocked|DemoHex|RequestAccess|Cellular)/.test(f) &&
				f.endsWith(".tsx") &&
				!f.includes(".stories"),
		)
		for (const f of suspects) {
			expect(known.has(f), `${f} looks like a gate surface but is not in GATE_FILES`).toBe(true)
		}
	})
})
