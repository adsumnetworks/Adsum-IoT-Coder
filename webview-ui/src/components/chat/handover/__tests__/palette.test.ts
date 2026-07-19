import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Palette compliance for the handover surfaces — UI-GOLDEN-RULES.md as a test.
 *
 * Written after a real regression: the conductor pill shipped with
 * `background: var(--vscode-badge-background)`, which is a saturated blue block in light themes, and
 * the coral label on it was effectively unreadable. Eyeballing dark mode is not enough — these are the
 * rules that were actually broken, so they are the rules that get asserted.
 */

const DIR = path.resolve(__dirname, "..")
const WELCOME = path.resolve(__dirname, "../../welcome")
const files = [
	path.join(DIR, "AgentStrip.tsx"),
	path.join(DIR, "MilestoneList.tsx"),
	path.join(WELCOME, "AgentRunRow.tsx"),
	path.join(WELCOME, "StatusHeader.tsx"),
]
const read = (f: string) => fs.readFileSync(f, "utf8")

describe("handover UI palette compliance", () => {
	it("never fills a surface with --vscode-badge-background (a saturated accent in many themes)", () => {
		for (const f of files) {
			const src = read(f)
			// allowed in a comment explaining why we avoid it; never in an actual style value
			const offending = src.split("\n").filter((l) => l.includes("badge-background") && !l.trim().startsWith("//"))
			expect(offending, `${path.basename(f)} must not paint with the badge accent`).toEqual([])
		}
	})

	it("hard-codes no brand hexes — tokens come from brandColors.ts", () => {
		for (const f of files) {
			const src = read(f)
			// #fff on a filled cyan button is the house convention (UpgradeCard/CraNudge/CraStepMarker)
			const hexes = (src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((h) => h.toLowerCase() !== "#fff")
			expect(hexes, `${path.basename(f)} should import tokens, not hard-code hexes`).toEqual([])
		}
	})

	it("puts text only on the on-fill cyan token, matching UpgradeCard/CraNudge", () => {
		const src = read(path.join(DIR, "AgentStrip.tsx"))
		// Filled BUTTONS (text on a fill) must use CYAN_700 + #fff — the CYAN_600 base is allowed for
		// textless indicator dots only. The invented "#04222a on CYAN_600" pairing must never return.
		expect(src).toMatch(/background:\s*(closed \? )?BRAND_CYAN_700/)
		expect(src).not.toContain("#04222a")
	})

	it("selects cyan text by theme wherever it sits on a tinted surface (FreeTierStrip's recipe)", () => {
		for (const f of [path.join(DIR, "AgentStrip.tsx"), path.join(WELCOME, "AgentRunRow.tsx")]) {
			const src = read(f)
			expect(src, `${path.basename(f)} must not pin one cyan for both themes`).toContain("useVSCodeTheme")
			expect(src).toMatch(/isDark \? BRAND_CYAN_300 : BRAND_CYAN_700/)
		}
	})

	it("keeps coral for identity and semantic colors for status only — never a verdict", () => {
		const strip = read(path.join(DIR, "AgentStrip.tsx"))
		// green marks the CLOSED state (a status), and must not be attached to any quality claim
		expect(strip).toMatch(/closed:\s*BRAND_SUCCESS/)
		expect(strip).not.toMatch(/BRAND_SUCCESS.*(good|pass|safe|correct|compliant)/i)
		// the conductor pill is identity → coral, and carries no fill
		const header = read(path.join(WELCOME, "StatusHeader.tsx"))
		expect(header).toMatch(/border:\s*`1px solid \$\{brandAlpha\(BRAND_CORAL/)
		expect(header).toMatch(/background:\s*"transparent"/)
	})
})
