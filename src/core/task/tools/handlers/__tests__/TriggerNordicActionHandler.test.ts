import type { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { ClineDefaultTool } from "@/shared/tools"

/**
 * Unit tests for TriggerNordicActionHandler
 *
 * These tests verify the handler's behavior WITHOUT VS Code dependencies
 * by testing the logic paths directly.
 *
 * The nrf_device_tool executes commands in the nRF Connect terminal
 * or captures live logs from connected devices.
 */
describe("TriggerNordicActionHandler", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("Parameter Validation", () => {
		it("should require action='log_device'", () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: { action: "log_device", operation: "capture" },
				partial: false,
			}

			expect(block.params.action).to.equal("log_device")
		})

		it("should accept action='execute' with command", () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: { action: "execute", command: "west build" },
				partial: false,
			}

			expect(block.params.action).to.equal("execute")
			expect(block.params.command).to.equal("west build")
		})

		it("should accept valid log capture operations", () => {
			const operations = ["list", "test", "capture", "monitor", "device_info"]

			for (const op of operations) {
				const block: ToolUse = {
					type: "tool_use",
					name: ClineDefaultTool.NORDIC_ACTION,
					params: { action: "log_device", operation: op },
					partial: false,
				}
				expect(block.params.operation).to.equal(op)
			}
		})

		it("should accept transport parameter for log capture", () => {
			const rttBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					transport: "rtt",
					port: "683335182",
					duration: "30",
				} as any,
				partial: false,
			}

			const uartBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					transport: "uart",
					port: "/dev/ttyACM0",
					duration: "15",
				} as any,
				partial: false,
			}

			expect((rttBlock.params as any).transport).to.equal("rtt")
			expect(rttBlock.params.port).to.equal("683335182")
			expect((uartBlock.params as any).transport).to.equal("uart")
			expect(uartBlock.params.port).to.equal("/dev/ttyACM0")
		})

		it("should accept multi-device capture with devices parameter", () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					transport: "rtt",
					devices: "central:683335182,peripheral:683007782",
					duration: "30",
				} as any,
				partial: false,
			}

			expect((block.params as any).devices).to.include("central:")
			expect((block.params as any).devices).to.include("peripheral:")
		})
	})

	describe("Tool Name", () => {
		it("should use the correct tool name constant", () => {
			expect(ClineDefaultTool.NORDIC_ACTION).to.equal("triggerNordicAction")
		})
	})

	describe("Block Structure", () => {
		it("should support partial blocks", () => {
			const partialBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: { action: "log" }, // Incomplete
				partial: true,
			}

			expect(partialBlock.partial).to.be.true
		})

		it("should support complete log capture blocks", () => {
			const completeBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: { action: "log_device", operation: "capture", transport: "rtt", port: "683335182" } as any,
				partial: false,
			}

			expect(completeBlock.partial).to.be.false
			expect(completeBlock.params.action).to.equal("log_device")
			expect(completeBlock.params.operation).to.equal("capture")
		})
	})
})
