import { describe, expect, it } from "vitest"
import { DEFAULT_DEMO_SCENARIO_ID, DEMO_HISTORY_MATCH, DEMO_SCENARIO_LIST, DEMO_SCENARIOS, hasRunDemo } from "../demoScenarios"

describe("demoScenarios registry", () => {
	it("default scenario id resolves to a scenario", () => {
		expect(DEMO_SCENARIOS[DEFAULT_DEMO_SCENARIO_ID]).toBeDefined()
	})

	it("default scenario carries the host trigger in its prompt", () => {
		expect(DEMO_SCENARIOS[DEFAULT_DEMO_SCENARIO_ID].taskPrompt).toContain("[ADSUM_DEMO:nus-uart]")
	})

	it("registers the cra-sample scenario with its own host trigger", () => {
		expect(DEMO_SCENARIOS["cra-sample"]).toBeDefined()
		expect(DEMO_SCENARIOS["cra-sample"].taskPrompt).toContain("[ADSUM_DEMO:cra-sample]")
	})

	it("exposes at least two scenarios so the picker can render (count gate)", () => {
		expect(DEMO_SCENARIO_LIST.length).toBeGreaterThanOrEqual(2)
	})

	it("every scenario carries a platform badge, an icon, and a history-match prefix", () => {
		for (const s of DEMO_SCENARIO_LIST) {
			expect(s.historyMatch.length).toBeGreaterThan(0)
			expect(s.icon.length).toBeGreaterThan(0)
			expect(["nrf", "esp"]).toContain(s.platform)
		}
	})

	it("each scenario's host trigger token matches its id", () => {
		for (const s of DEMO_SCENARIO_LIST) {
			expect(s.taskPrompt).toContain(`[ADSUM_DEMO:${s.id}]`)
		}
	})
})

describe("DEMO_HISTORY_MATCH — sync anchor", () => {
	// Regression: this literal must match the leading text of DemoManager.buildDemoDisplayText().
	// If the host display text changes, this constant (and the host note) must change together,
	// otherwise the welcome demo card silently stops demoting.
	it("is the stable demo bubble-text prefix", () => {
		expect(DEMO_HISTORY_MATCH).toBe("Debug a real BLE NUS bug")
	})
})

describe("hasRunDemo — persistent demo-seen detection", () => {
	const demoItem = {
		task: "Debug a real BLE NUS bug — Central→Peripheral works, but Peripheral→Central is silently dropped.",
	}
	const otherItem = { task: "Add a Zephyr shell to central_uart" }

	it("false for undefined history", () => {
		expect(hasRunDemo(undefined)).toBe(false)
	})

	it("false for empty history", () => {
		expect(hasRunDemo([])).toBe(false)
	})

	it("false when no entry matches the demo prefix", () => {
		expect(hasRunDemo([otherItem, { task: "Build & flash" }])).toBe(false)
	})

	it("true when any entry starts with the demo prefix", () => {
		expect(hasRunDemo([otherItem, demoItem])).toBe(true)
	})

	it("true when an entry matches the cra-sample prefix (any registered scenario counts)", () => {
		const craItem = {
			task: "Preview CRA readiness on a bundled sample — a real SBOM + secure-by-design posture, not your build.",
		}
		expect(hasRunDemo([otherItem, craItem])).toBe(true)
	})

	it("matches on prefix only (not substring mid-string)", () => {
		expect(hasRunDemo([{ task: "Please Debug a real BLE NUS bug for me" }])).toBe(false)
	})

	it("tolerates entries with empty task text", () => {
		expect(hasRunDemo([{ task: "" }])).toBe(false)
	})
})
