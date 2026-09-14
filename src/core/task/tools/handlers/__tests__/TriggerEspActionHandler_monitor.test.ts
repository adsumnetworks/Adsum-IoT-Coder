import type { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { ClineDefaultTool } from "@/shared/tools"

const proxyquire = require("proxyquire")

// 2026-09-14: a capture on a board nobody had confirmed reset it before recording (nRF side). The ESP monitor
// had the same default — reset unless reset="false" — so a monitor capture also rebooted whatever board sat
// on the port. A monitor reads the board; the reset is an opt-in the agent has to name.
describe("TriggerEspActionHandler monitor reset is an explicit opt-in", () => {
	let sandbox: sinon.SinonSandbox
	let handler: any

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		const HandlerClass = proxyquire("../TriggerEspActionHandler", {
			vscode: { "@noCallThru": true },
			"@/hosts/vscode/hostbridge/workspace/executeEspCommand": {
				markEspTerminalSourced: sandbox.stub(),
				prepareEspTerminal: sandbox.stub(),
				wrapEspCommand: sandbox.stub(),
			},
			"@/services/telemetry": { telemetryService: {} },
			"@/services/tools/ToolResolver": {
				pathOfAsync: sandbox.stub().resolves({
					path: "/ext/iot-knowledge/platforms/esp/tools/esp-monitor/esp-monitor",
					tool: { id: "adsum/esp/tools/esp-monitor" },
				}),
			},
			"@/services/tools/toolCredit": { creditToolById: sandbox.stub().resolves() },
		}).TriggerEspActionHandler
		handler = new HandlerClass({})
	})

	afterEach(() => sandbox.restore())

	const argv = async (params: Record<string, string>) => {
		const block = {
			type: "tool_use",
			name: ClineDefaultTool.ESP_ACTION,
			params: { action: "monitor", ...params },
			partial: false,
		}
		const cmd: string = await handler.buildMonitorCommand("/proj", block as unknown as ToolUse)
		return cmd.split(" ")
	}

	it("a monitor with no reset parameter passes --no-reset and never --reset", async () => {
		const a = await argv({ port: "/dev/ttyUSB0" })
		expect(a).to.include("--no-reset")
		expect(a).to.not.include("--reset")
	})

	it("a multi-board monitor with no reset parameter passes --no-reset", async () => {
		const a = await argv({ devices: "a:/dev/ttyUSB0,b:/dev/ttyUSB1" })
		expect(a).to.include("--no-reset")
		expect(a).to.not.include("--reset")
	})

	it('reset="true" is the only way to get --reset', async () => {
		const a = await argv({ port: "/dev/ttyUSB0", reset: "true" })
		expect(a).to.include("--reset")
		expect(a).to.not.include("--no-reset")
	})

	it("any other reset value is --no-reset", async () => {
		for (const value of ["false", "yes", "1", ""]) {
			const a = await argv({ port: "/dev/ttyUSB0", reset: value })
			expect(a, `reset="${value}"`).to.include("--no-reset")
			expect(a, `reset="${value}"`).to.not.include("--reset")
		}
	})

	it("the tool text says a monitor does not reset unless reset=true is named", () => {
		const { trigger_esp_action_variants } = require("@core/prompts/system-prompt/tools/trigger_esp_action")
		for (const variant of trigger_esp_action_variants) {
			const reset = variant.parameters?.find((p: { name: string }) => p.name === "reset")
			expect(reset, String(variant.variant)).to.exist
			expect(reset.instruction).to.include("DEFAULT: false")
			expect(reset.instruction).to.include("confirmed is the one under discussion")
			expect(reset.instruction).to.not.include("DEFAULT: true")
			expect(variant.description).to.not.include("resets the board first by default")
		}
	})
})
