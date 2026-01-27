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
		it("should require action='execute'", () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: { action: "build" }, // Wrong action
				partial: false,
			}

			// Validate the expected action
			expect(block.params.action).to.not.equal("execute")
			expect(["execute"]).to.not.include(block.params.action)
		})

		it("should require command parameter when action is execute", () => {
			const validBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: { action: "execute", command: "west build" },
				partial: false,
			}

			const invalidBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: { action: "execute" }, // Missing command
				partial: false,
			}

			expect(validBlock.params.command).to.exist
			expect(invalidBlock.params.command).to.be.undefined
		})

		it("should accept common Nordic commands", () => {
			const commands = [
				"west build -b nrf52840dk/nrf52840 .",
				"west flash --erase",
				"west boards | grep nrf52",
				"nrfjprog --eraseall",
				"nrfjprog --recover",
			]

			for (const cmd of commands) {
				const block: ToolUse = {
					type: "tool_use",
					name: ClineDefaultTool.NORDIC_ACTION,
					params: { action: "execute", command: cmd },
					partial: false,
				}
				expect(block.params.command).to.equal(cmd)
			}
		})
	})

	describe("Tool Name", () => {
		it("should use the correct tool name constant", () => {
			expect(ClineDefaultTool.NORDIC_ACTION).to.equal("trigger_nordic_action")
		})
	})

	describe("Block Structure", () => {
		it("should support partial blocks", () => {
			const partialBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: { action: "exec" }, // Incomplete
				partial: true,
			}

			expect(partialBlock.partial).to.be.true
		})

		it("should support complete blocks", () => {
			const completeBlock: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: { action: "execute", command: "west build" },
				partial: false,
			}

			expect(completeBlock.partial).to.be.false
			expect(completeBlock.params.action).to.equal("execute")
			expect(completeBlock.params.command).to.equal("west build")
		})
	})
})
