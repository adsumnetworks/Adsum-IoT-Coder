import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { ToolUse } from "@core/assistant-message"
import proxyquire from "proxyquire"
import sinon from "sinon"
import { ClineDefaultTool } from "@/shared/tools"
import { TaskConfig } from "../../types/TaskConfig"

// Define strict types for the handler class
interface TriggerNordicActionHandlerClass {
	new (): any // We can be loose here since we only access known methods
	prototype: any
}

describe("TriggerNordicActionHandler", () => {
	let handler: any // Using any because we're loading via proxyquire
	let sandbox: sinon.SinonSandbox
	let config: TaskConfig
	let saySpy: sinon.SinonSpy
	let executeCommandStub: sinon.SinonStub
	let getExtensionStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		saySpy = sandbox.spy()
		executeCommandStub = sandbox.stub().resolves()
		getExtensionStub = sandbox.stub().returns({} as any)

		const vscodeMock = {
			commands: {
				executeCommand: executeCommandStub,
			},
			extensions: {
				getExtension: getExtensionStub,
			},
		}

		// Load the handler using proxyquire to insert the mock
		const module = proxyquire("../TriggerNordicActionHandler", {
			vscode: vscodeMock,
		})

		const HandlerClass = module.TriggerNordicActionHandler
		handler = new HandlerClass()

		config = {
			taskState: {
				consecutiveMistakeCount: 0,
			},
			callbacks: {
				say: saySpy,
				sayAndCreateMissingParamError: sandbox.stub().resolves("missing_param_error"),
			},
		} as unknown as TaskConfig
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should handle 'build' action", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "build" },
			partial: false,
		}

		const result = await handler.execute(config, block)

		sinon.assert.calledWith(executeCommandStub, "nrf-connect.build")
		result.should.be.a.String()
		;(result as string).should.containEql("Successfully triggered nRF Connect action: build")
	})

	it("should handle 'flash' action", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "flash" },
			partial: false,
		}

		await handler.execute(config, block)
		sinon.assert.calledWith(executeCommandStub, "nrf-connect.flash")
	})

	it("should handle 'terminal' action", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "terminal" },
			partial: false,
		}

		await handler.execute(config, block)
		sinon.assert.calledWith(executeCommandStub, "nrf-connect.createNcsTerminal")
	})

	it("should return error for invalid action", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "invalid_action" },
			partial: false,
		}

		const result = await handler.execute(config, block)
		result.should.be.a.String()
		;(result as string).should.containEql("Invalid action")
	})

	it("should warn if extension is missing", async () => {
		getExtensionStub.returns(undefined)

		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "build" },
			partial: false,
		}

		const result = await handler.execute(config, block)
		result.should.be.a.String()
		;(result as string).should.containEql("nRF Connect Extension not detected")
	})
})
