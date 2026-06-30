import type { NrfEnvironment } from "@shared/nrf"
import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildDemoDisplayText,
	buildDemoPrompt,
	buildHciSnifferDisplayText,
	buildHciSnifferPrompt,
	classifyDemoCapability,
	type DemoWorkspace,
	hciSnifferOpenInEditor,
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
			expect(p).to.contain("--dev-id") // canonical flag; --snr is deprecated (flash.md)
			expect(p).to.not.contain('Type **"flash it"**')
		})

		it("hardware tier is board-flexible + shell-agnostic (no hardcoded board pair / POSIX-only shell)", () => {
			const p = buildDemoPrompt(
				ws,
				"hardware",
				env({ installedSdkVersions: ["v3.2.1"], nrfutilPresent: true, boards: [board("1"), board("2")] }),
			)
			// the live tier must not bake in a fixed /tmp POSIX build path or the deprecated --snr flag
			expect(p).to.not.contain("/tmp/adsum_demo")
			expect(p).to.not.contain("--snr")
			// it must be Windows-first (taskkill, not POSIX-only pkill) ...
			expect(p).to.contain("taskkill")
			// ... and tell the agent to resolve the target itself and build from a space-free copy
			expect(p).to.contain("NO SPACES")
			expect(p).to.contain("resolve")
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

describe("hci-sniffer demo (hardware-adaptive 3-layer)", () => {
	before(() => {
		initDemoManager("/ext", "/storage")
	})

	it("display text is synced with the demoScenarios.ts historyMatch prefix", () => {
		expect(buildHciSnifferDisplayText().startsWith("HCI + sniffer-in-the-loop BLE debug")).to.equal(true)
	})

	it("opens ONE small curated evidence file, not the raw multi-hundred-line dumps", () => {
		const files = hciSnifferOpenInEditor("/storage/demo/hci-sniffer-1").map((f) => f.replace(/\\/g, "/"))
		expect(files.length).to.equal(1)
		expect(files[0].endsWith("logs/buggy/curated.md")).to.equal(true)
	})

	it("leads with a device scan + a mermaid + the always-on captured-walkthrough button", () => {
		const p = buildHciSnifferPrompt("/storage/demo/hci-sniffer-1", "canned")
		expect(p).to.contain('operation="list"') // scans connected hardware in-chat
		expect(p).to.contain("mermaid")
		expect(p).to.contain("sequenceDiagram")
		expect(p).to.contain("Walk me through the captured bug")
		expect(p).to.contain("ask_followup_question")
	})

	it("offers live-capture options gated on hardware (DK / dongle)", () => {
		const p = buildHciSnifferPrompt("/storage/demo/hci-sniffer-1", "hardware")
		expect(p).to.contain("Capture it live on my board") // DK tier
		expect(p).to.contain("Capture live + sniff over the air") // DK + dongle tier
		expect(p).to.contain("capability=hardware") // host hint is passed through
	})

	it("calls out missing hardware and offers the 1-DK phone-as-central + OTA escalation tiers", () => {
		const p = buildHciSnifferPrompt("/storage/demo/hci-sniffer-1", "hardware")
		// STEP 1 must name the dongle (so a missing one is surfaced), not silently omit the option
		expect(p).to.contain("sniffer dongle")
		// 1-DK tier uses the phone as the central peer
		expect(p.toLowerCase()).to.contain("phone")
		// OTA tier follows the demo peripheral by its advertised name
		expect(p).to.contain("Nordic_UART_Service")
		// every tier nudges the next hardware rung
		expect(p).to.contain("over the air")
	})

	it("threads the cached env (DK count) into the prompt", () => {
		const p = buildHciSnifferPrompt(
			"/storage/demo/hci-sniffer-1",
			"hardware",
			env({ installedSdkVersions: ["v3.2.1"], nrfutilPresent: true, boards: [board("1"), board("2")] }),
		)
		expect(p).to.contain("DKs detected=2")
	})

	it("names the one-line fix and enforces the brevity/style contract", () => {
		const p = buildHciSnifferPrompt("/storage/demo/hci-sniffer-1", "canned")
		expect(p).to.contain("bt_nus_subscribe_receive(&nus);")
		expect(p).to.contain("STYLE CONTRACT")
		expect(p.trimEnd().endsWith("<!--TASK_COMPLETE-->")).to.equal(true)
	})

	it("is honesty-locked: app BLIND, quantified signatures, curated-only reads, no fabricated 'received'", () => {
		const p = buildHciSnifferPrompt("/storage/demo/hci-sniffer-1", "canned")
		expect(p).to.contain("BLIND") // app layer can't see the bug — the trap that justifies the deeper layers
		expect(p).to.contain("3 → 22") // real HCI ACL-frame signature (not a fabricated "ATT Write" line)
		expect(p).to.contain("4 → 25") // real over-the-air DATA-PDU signature
		expect(p).to.contain("READ ONLY") // token discipline: the curated slices, not the 1374-line raws
		expect(p).to.contain("curated.md")
		expect(p).to.contain("Do NOT claim the app log shows") // never fabricate received data
	})

	it("closes by bridging to the CRA feature (grounded, decline-able, evidence-mode)", () => {
		const p = buildHciSnifferPrompt("/storage/demo/hci-sniffer-1", "canned")
		expect(p).to.contain("Preview CRA readiness on this build")
		expect(p).to.contain("Cyber Resilience Act")
		expect(p).to.contain("conformity verdict") // framed as a readiness aid, NOT a verdict
	})
})
