import type { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import proxyquire from "proxyquire"
import sinon from "sinon"
import { ClineDefaultTool } from "@/shared/tools"

describe("TriggerNordicActionHandler (log_device)", () => {
	let sandbox: sinon.SinonSandbox
	let handler: any // Typed as any to access private methods if needed (though we test public execute)
	let mockVscode: any
	let mockActivateNordicTerminal: sinon.SinonStub
	let mockExecuteCommandTool: sinon.SinonStub
	let mockTaskConfig: any

	// Path to the module under test
	const MODULE_PATH = "../TriggerNordicActionHandler"

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Mock vscode
		mockVscode = {
			ExtensionContext: class {},
			Uri: { file: (path: string) => ({ fsPath: path }) },
		}

		// Mock ExtensionContext
		const mockContext = {
			extensionUri: { fsPath: "/mock/extension/path" },
		}

		// Mock external dependencies
		mockActivateNordicTerminal = sandbox.stub().resolves("nRF Terminal")

		// Load the class with mocks
		const TriggerNordicActionHandlerClass = proxyquire(MODULE_PATH, {
			vscode: mockVscode,
			"@/hosts/vscode/hostbridge/workspace/executeNordicCommand": {
				activateNordicTerminal: mockActivateNordicTerminal,
			},
			"@/shared/tools": {
				ClineDefaultTool: { NORDIC_ACTION: "trigger_nordic_action" },
			},
			"@core/prompts/responses": {
				formatResponse: {
					toolError: (msg: string) => ({ type: "tool_error", content: msg }),
				},
			},
		}).TriggerNordicActionHandler

		// Instantiate handler
		handler = new TriggerNordicActionHandlerClass(mockContext)

		// Setup TaskConfig mock
		mockExecuteCommandTool = sandbox.stub().resolves([false, { type: "tool_result", content: "Success" }])
		mockTaskConfig = {
			callbacks: {
				say: sandbox.stub().resolves(),
				sayAndCreateMissingParamError: sandbox.stub().resolves({ type: "tool_error", content: "Missing param" }),
				executeCommandTool: mockExecuteCommandTool,
			},
			taskState: {
				consecutiveMistakeCount: 0,
				didRejectTool: false,
			},
		}
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("should handle 'log_device' action with 'list' operation", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "log_device", operation: "list" },
			partial: false,
		}

		await handler.execute(mockTaskConfig, block)

		// Verify executeCommandTool was called with the wrapper script (NOT python3)
		// Path should be: /mock/extension/path/assets/scripts/nordic-logger
		expect(mockExecuteCommandTool.calledOnce).to.be.true
		const cmd = mockExecuteCommandTool.firstCall.args[0]
		// Should contain the wrapper script path
		expect(cmd).to.contain("/mock/extension/path/assets/scripts/nordic-logger")
		expect(cmd).to.contain("--list")
		// Should NOT contain python3 or .py file
		expect(cmd).to.not.contain("python3")
		expect(cmd).to.not.contain("nrf_logger.py")
	})

	it("should handle 'log_device' action with 'test' operation", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "log_device", operation: "test", port: "/dev/ttyACM0" },
			partial: false,
		}

		await handler.execute(mockTaskConfig, block)

		const cmd = mockExecuteCommandTool.firstCall.args[0]
		expect(cmd).to.contain("--test")
		expect(cmd).to.contain("--port /dev/ttyACM0")
	})

	it("should fail 'test' operation if port is missing", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "log_device", operation: "test" }, // Missing port
			partial: false,
		}

		const result = await handler.execute(mockTaskConfig, block)
		expect(result.type).to.equal("tool_error")
		expect(mockExecuteCommandTool.called).to.be.false
	})

	it("should handle 'log_device' action with 'capture' operation (single device)", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: {
				action: "log_device",
				operation: "capture",
				port: "/dev/ttyACM0",
				duration: "10",
				output: "logs/",
			},
			partial: false,
		}

		await handler.execute(mockTaskConfig, block)

		const cmd = mockExecuteCommandTool.firstCall.args[0]
		expect(cmd).to.contain("--port /dev/ttyACM0")
		expect(cmd).to.contain("--duration 10")
		expect(cmd).to.contain("--output logs/")
		expect(cmd).to.not.contain("--devices")
	})

	it("should handle 'log_device' action with 'capture' operation (multi device)", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: {
				action: "log_device",
				operation: "capture",
				devices: "central:/dev/tty0,periph:/dev/tty1",
				duration: "60",
			},
			partial: false,
		}

		await handler.execute(mockTaskConfig, block)

		const cmd = mockExecuteCommandTool.firstCall.args[0]
		expect(cmd).to.contain("--devices central:/dev/tty0,periph:/dev/tty1")
		expect(cmd).to.contain("--duration 60")
		expect(cmd).to.not.contain("--port")
	})

	it("should use wrapper script (not python3 directly)", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "log_device", operation: "list" },
			partial: false,
		}

		await handler.execute(mockTaskConfig, block)
		const cmd = mockExecuteCommandTool.firstCall.args[0]
		// Should start with the wrapper path, NOT python3
		expect(cmd).to.contain("nordic-logger")
		expect(cmd).to.not.contain("python3")
	})

	it("should still support legacy 'execute' action", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "execute", command: "west build" }, // Legacy generic
			partial: false,
		}

		await handler.execute(mockTaskConfig, block)
		const cmd = mockExecuteCommandTool.firstCall.args[0]
		expect(cmd).to.equal("west build")
	})
})
