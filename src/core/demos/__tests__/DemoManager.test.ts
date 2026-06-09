import type { NrfEnvironment } from "@shared/nrf"
import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildDemoDisplayText,
	buildDemoPrompt,
	classifyDemoCapability,
	type DemoWorkspace,
	initDemoManager,
} from "../DemoManager"

// Minimal NrfEnvironment factory for capability classification.
const env = (over: Partial<NrfEnvironment>): NrfEnvironment => ({
	status: "ready",
	extensionPresent: true,
	nrfutilPresent: false,
	boards: [],
	...over,
})

const board = (sn: string) => ({ serialNumber: sn })

const ws: DemoWorkspace = {
	rootPath: "/tmp/demo",
	centralPath: "/tmp/demo/central_uart",
	peripheralPath: "/tmp/demo/peripheral_uart",
}

describe("classifyDemoCapability", () => {
	it("undefined env → canned (bulletproof floor)", () => {
		expect(classifyDemoCapability(undefined)).to.equal("canned")
	})

	it("status not ready → canned", () => {
		expect(classifyDemoCapability(env({ status: "detecting" }))).to.equal("canned")
	})

	it("ready but no NCS → canned", () => {
		expect(classifyDemoCapability(env({ status: "ready" }))).to.equal("canned")
	})

	it("ready + NCS, no nrfutil/boards → build", () => {
		expect(classifyDemoCapability(env({ installedSdkVersions: ["v3.2.1"] }))).to.equal("build")
	})

	it("ready + NCS + nrfutil but zero boards → build", () => {
		expect(classifyDemoCapability(env({ installedSdkVersions: ["v3.2.1"], nrfutilPresent: true }))).to.equal("build")
	})

	it("ready + NCS + nrfutil + a board → hardware", () => {
		expect(
			classifyDemoCapability(env({ installedSdkVersions: ["v3.2.1"], nrfutilPresent: true, boards: [board("683907940")] })),
		).to.equal("hardware")
	})

	it("projectSdk alone counts as NCS present", () => {
		expect(
			classifyDemoCapability(env({ projectSdk: { version: "v3.2.1", source: "build", topology: "workspace" } })),
		).to.equal("build")
	})
})

describe("buildDemoDisplayText", () => {
	it("starts with the DEMO_HISTORY_MATCH prefix the webview relies on", () => {
		// Regression: keep in sync with DEMO_HISTORY_MATCH in webview demoScenarios.ts.
		// If this breaks, the welcome demo card stops demoting after the first run.
		expect(buildDemoDisplayText().startsWith("Debug a real BLE NUS bug")).to.equal(true)
	})

	it("is a short honest one-liner — no file paths, no runbook beats", () => {
		const text = buildDemoDisplayText()
		expect(text).to.not.contain("/")
		expect(text.toLowerCase()).to.not.contain("beat")
	})
})

describe("buildDemoPrompt", () => {
	before(() => {
		initDemoManager("/ext", "/storage")
	})

	it("ends with exactly the TASK_COMPLETE marker", () => {
		expect(buildDemoPrompt(ws, "canned").trimEnd().endsWith("<!--TASK_COMPLETE-->")).to.equal(true)
	})

	describe("spoiler guard (regression — issue: canned verdict leaked on early interrupt)", () => {
		const prompt = () => buildDemoPrompt(ws, "canned")

		it("forbids naming the fix function before Beat 3", () => {
			expect(prompt()).to.contain("the first time you may name bt_nus_subscribe_receive() is Beat 3")
		})

		it("forbids reciting a verdict on interrupt / force-complete", () => {
			const p = prompt()
			expect(p).to.contain("EARNED by the reads")
			expect(p).to.contain("do NOT state a root cause")
			expect(p).to.contain("pre-canned")
		})

		it("gates attempt_completion on having done the reads + beats", () => {
			expect(buildDemoPrompt(ws, "canned")).to.contain("only AFTER you have done the reads and presented the beats")
		})
	})

	describe("escalation ends with a button choice (ask_followup_question) per capability", () => {
		it("canned → buttons: one-line fix + wrap-up; no build/flash actions, no legacy 'type' invite", () => {
			const p = buildDemoPrompt(ws, "canned")
			expect(p).to.contain("ask_followup_question")
			expect(p).to.contain("Show me the one-line fix")
			expect(p).to.contain("I've seen enough — wrap up")
			expect(p).to.not.contain('Type **"build it"**')
			expect(p).to.not.contain("west build")
			expect(p).to.not.contain("west flash")
		})

		it("build → buttons: 'Build it' + the one-line fix; no flashing", () => {
			const p = buildDemoPrompt(ws, "build", env({ installedSdkVersions: ["v3.2.1"] }))
			expect(p).to.contain("ask_followup_question")
			expect(p).to.contain("Build it — prove the fix compiles")
			expect(p).to.contain("bt_nus_subscribe_receive(nus);")
			expect(p).to.contain("west build")
			expect(p).to.not.contain("west flash")
			expect(p).to.not.contain('Type **"build it"**')
		})

		it("hardware → buttons: live flash + build-only fallback + wrap-up", () => {
			const p = buildDemoPrompt(
				ws,
				"hardware",
				env({ installedSdkVersions: ["v3.2.1"], nrfutilPresent: true, boards: [board("683907940")] }),
			)
			expect(p).to.contain("ask_followup_question")
			expect(p).to.contain("Flash & run it live on my boards")
			expect(p).to.contain("Just build it — no boards needed")
			expect(p).to.contain("west flash")
			expect(p).to.contain("--snr")
			expect(p).to.not.contain('Type **"flash it"**')
		})

		it("every tier offers the wrap-up / stop option that completes the task", () => {
			const envFull = env({ installedSdkVersions: ["v3.2.1"], nrfutilPresent: true, boards: [board("1")] })
			for (const cap of ["canned", "build", "hardware"] as const) {
				expect(buildDemoPrompt(ws, cap, envFull), cap).to.contain("I've seen enough — wrap up")
			}
		})

		it("the close is gated behind the verdict (no completion before reads + beats)", () => {
			expect(buildDemoPrompt(ws, "canned")).to.contain("only AFTER you have done the reads and presented the beats")
		})
	})

	it("references all six evidence files by their real paths", () => {
		const p = buildDemoPrompt(ws, "canned")
		// buildDemoPrompt composes the evidence paths with path.join, which emits backslashes on
		// Windows; the fixture paths are POSIX. Compare separator-agnostically so the assertion holds
		// on every OS (the product uses native paths at runtime — only this string check needs it).
		const norm = p.replace(/\\/g, "/")
		expect(norm).to.contain("demo-debug.md")
		expect(norm).to.contain("BLE.md")
		expect(norm).to.contain(ws.centralPath)
		expect(norm).to.contain(ws.peripheralPath)
	})
})
