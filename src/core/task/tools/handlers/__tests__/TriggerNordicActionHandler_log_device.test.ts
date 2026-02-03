import type { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import proxyquire from "proxyquire"
import sinon from "sinon"
import { ClineDefaultTool } from "@/shared/tools"

describe("TriggerNordicActionHandler (log_device)", () => {
	let sandbox: sinon.SinonSandbox
	let handler: any
	let mockVscode: any
	let mockActivateNordicTerminal: sinon.SinonStub
	let mockExecuteCommandTool: sinon.SinonStub
	let mockTaskConfig: any
	let mockExec: sinon.SinonStub

	// Path to the module under test
	const MODULE_PATH = "../TriggerNordicActionHandler"

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Mock vscode
		mockVscode = {
			ExtensionContext: class {},
			Uri: { file: (path: string) => ({ fsPath: path }) },
			workspace: { workspaceFolders: [] }, // Removed usage, but safe to keep empty
		}

		// Mock ExtensionContext
		const mockContext = {
			extensionUri: { fsPath: "/mock/extension/path" },
		}

		// Mock external dependencies
		mockActivateNordicTerminal = sandbox.stub().resolves("nRF Terminal")

		// Mock child_process exec
		mockExec = sandbox.stub()

		// Load the class with mocks
		const TriggerNordicActionHandlerClass = proxyquire(MODULE_PATH, {
			vscode: mockVscode,
			"node:child_process": { exec: mockExec },
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
			cwd: "/mock/workspace", // ADDED for relative path resolution
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

	it("should handle 'log_device' action with 'list' operation internally", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "log_device", operation: "list" },
			partial: false,
		}

		// Mock successful python script execution
		mockExec.yields(null, "Connected nRF Devices:\n  /dev/ttyACM0\n    Serial: 123456789", "")

		const result = await handler.execute(mockTaskConfig, block)

		// Verify executeCommandTool was NOT called (internal now)
		expect(mockExecuteCommandTool.called).to.be.false

		// Verify exec called with python script
		expect(mockExec.calledOnce).to.be.true
		const execCmd = mockExec.firstCall.args[0]
		expect(execCmd).to.contain("python3")
		expect(execCmd).to.contain("nrf_logger.py")
		expect(execCmd).to.contain("--list-nrf")

		// Verify result format
		expect(result).to.be.an("array")
		expect(result[0].type).to.equal("text")
		expect(result[0].text).to.include("/dev/ttyACM0")
		expect(result[0].text).to.include("Serial: 123456789")
	})

	it("should handle 'log_device' list operation when script fails", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "log_device", operation: "list" },
			partial: false,
		}

		// Mock failure
		mockExec.yields(new Error("Script failed"), "", "stderr error")

		const result = await handler.execute(mockTaskConfig, block)

		expect(result.type).to.equal("tool_error")
		expect(result.content).to.include("Failed to list devices via python script")
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

	it("should handle 'log_device' action with 'capture' operation", async () => {
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
		// Should resolve output path absolute
		expect(cmd).to.contain("--output /mock/workspace/logs/")
	})

	it("should use relative path for wrapper script when possible", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "log_device", operation: "test", port: "/dev/ttyACM0" },
			partial: false,
		}

		// In this setup:
		// CWD = /mock/workspace
		// Wrapper = /mock/extension/path/assets/scripts/nordic-logger
		// Relative path starts with ../.., so it should FALLBACK to absolute in our logic
		// logic: if (!relativePath.startsWith("..") ...)

		await handler.execute(mockTaskConfig, block)
		const cmd = mockExecuteCommandTool.firstCall.args[0]

		// Since /mock/extension is NOT inside /mock/workspace, it uses absolute
		expect(cmd).to.contain("/mock/extension/path/assets/scripts/nordic-logger")
	})
})
