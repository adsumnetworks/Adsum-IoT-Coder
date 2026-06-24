import type { ToolUse } from "@core/assistant-message"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { ClineDefaultTool } from "@/shared/tools"

// Use require for proxyquire to work reliably in mixed env
const proxyquire = require("proxyquire")

describe("TriggerNordicActionHandler (log_device)", () => {
	let sandbox: sinon.SinonSandbox
	let handler: any
	let mockVscode: any
	let mockPrepareNordicExecution: sinon.SinonStub
	let mockExecuteCommandTool: sinon.SinonStub
	let mockTaskConfig: any
	let mockExecFile: sinon.SinonStub

	// Path to the module under test
	const MODULE_PATH = "../TriggerNordicActionHandler"

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Mock vscode
		mockVscode = {
			ExtensionContext: class {},
			Uri: { file: (path: string) => ({ fsPath: path }) },
			workspace: { workspaceFolders: [] },
		}

		// Mock ExtensionContext
		const mockContext = {
			extensionUri: { fsPath: "/mock/extension/path" },
		}

		// Mock external dependencies. prepareNordicExecution echoes the built command body back
		// as the plan's command, so these tests keep asserting on the command handleLogDevice builds
		// (the terminal-tiering itself is covered by nordicEnvResolver / executeNordicCommand tests).
		mockPrepareNordicExecution = sandbox.stub().callsFake(async ({ body }: { body: string }) => ({
			kind: "ready",
			plan: { terminalName: "Adsum nRF", command: body, tier: 1 },
		}))

		// Mock child_process execFile
		mockExecFile = sandbox.stub()

		// Load the class with mocks using proxyquire
		const TriggerNordicActionHandlerClass = proxyquire(MODULE_PATH, {
			vscode: mockVscode,
			"node:child_process": { execFile: mockExecFile },
			"@/hosts/vscode/hostbridge/workspace/executeNordicCommand": {
				prepareNordicExecution: mockPrepareNordicExecution,
			},
			"@/platform/pythonDetector": {
				default: sandbox.stub().resolves("python3"),
			},
			"@/shared/tools": {
				ClineDefaultTool: { NORDIC_ACTION: "trigger_nordic_action" },
			},
			"@core/prompts/responses": {
				formatResponse: {
					toolError: (msg: string) => ({ type: "tool_error", content: msg }),
				},
			},
			"../../index": {},
		}).TriggerNordicActionHandler

		// Instantiate handler
		handler = new TriggerNordicActionHandlerClass(mockContext)
		// ... rest is similar but need to update mockExecFile usage to mockExecFileFile and fix expectations

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

	it("should handle 'log_device' action with 'list' operation via nRF terminal", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "log_device", operation: "list" },
			partial: false,
		}

		const result = await handler.execute(mockTaskConfig, block)

		// Verify executeCommandTool WAS called with nrfutil device list
		expect(mockExecuteCommandTool.calledOnce).to.be.true
		const cmd = mockExecuteCommandTool.firstCall.args[0]
		expect(cmd).to.equal("nrfutil device list")

		// Verify result format
		expect(result).to.be.an("object")
		expect((result as any).type).to.equal("tool_result")
	})

	it("should handle 'log_device' list operation when nrfutil fails", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.NORDIC_ACTION,
			params: { action: "log_device", operation: "list" },
			partial: false,
		}

		// Mock failure
		mockExecuteCommandTool.resolves([false, { type: "tool_error", content: "Command failed", error: "stderr error" }])

		const result = await handler.execute(mockTaskConfig, block)

		expect(result.type).to.equal("tool_error")
		expect(result.error).to.include("stderr error")
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
		const normalizedCmd = cmd.replace(/\\/g, "/")
		expect(normalizedCmd).to.contain("--port /dev/ttyACM0")
		expect(normalizedCmd).to.contain("--duration 10")
		// Should resolve output path absolute
		expect(normalizedCmd).to.contain("--output /mock/workspace/logs/")
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
		// Wrapper = /mock/extension/path/assets/scripts/uart-logger
		// Relative path starts with ../.., so it should FALLBACK to absolute in our logic
		// logic: if (!relativePath.startsWith("..") ...)

		await handler.execute(mockTaskConfig, block)
		const cmd = mockExecuteCommandTool.firstCall.args[0]
		// Normalize backslashes for Windows test env
		const normalizedCmd = cmd.replace(/\\/g, "/")

		// Since /mock/extension is NOT inside /mock/workspace, it uses absolute
		expect(normalizedCmd).to.contain("/mock/extension/path/assets/scripts/uart-logger")
	})

	// ============================================================================
	// RTT DISPATCH VERIFICATION TESTS
	// These tests ensure the handler correctly selects the RTT or UART wrapper
	// and passes the correct arguments
	// ============================================================================

	describe("RTT vs UART transport dispatch", () => {
		it("should use rtt-logger wrapper when transport='rtt'", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					transport: "rtt",
					auto_detect: "true",
					duration: "30",
				} as any,
				partial: false,
			}

			await handler.execute(mockTaskConfig, block)

			const cmd = mockExecuteCommandTool.firstCall.args[0]
			// CRITICAL: Must use rtt-logger, NOT uart-logger
			expect(cmd).to.contain("rtt-logger")
			expect(cmd).to.not.contain("uart-logger")
		})

		it("should use uart-logger wrapper when transport is undefined (UART default)", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					port: "/dev/ttyACM0",
					duration: "30",
				} as any,
				partial: false,
			}

			await handler.execute(mockTaskConfig, block)

			const cmd = mockExecuteCommandTool.firstCall.args[0]
			expect(cmd).to.contain("uart-logger")
			expect(cmd).to.not.contain("rtt-logger")
		})

		it("should use uart-logger wrapper when transport='uart'", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					transport: "uart",
					port: "/dev/ttyACM0",
					duration: "30",
				} as any,
				partial: false,
			}

			await handler.execute(mockTaskConfig, block)

			const cmd = mockExecuteCommandTool.firstCall.args[0]
			expect(cmd).to.contain("uart-logger")
		})
	})

	describe("--capture flag verification", () => {
		it("should include --capture flag when operation is capture (CRITICAL BUG FIX)", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					port: "/dev/ttyACM0",
					duration: "30",
				} as any,
				partial: false,
			}

			await handler.execute(mockTaskConfig, block)

			const cmd = mockExecuteCommandTool.firstCall.args[0]
			// UART script MUST have --capture flag now (unified)
			expect(cmd).to.contain("--capture")
		})

		it("should include --capture flag for RTT capture", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					transport: "rtt",
					auto_detect: "true",
				} as any,
				partial: false,
			}

			await handler.execute(mockTaskConfig, block)

			const cmd = mockExecuteCommandTool.firstCall.args[0]
			expect(cmd).to.contain("--capture")
			expect(cmd).to.contain("rtt-logger")
		})
	})

	describe("auto_detect parameter handling", () => {
		it("should include --auto-detect flag when auto_detect is 'true' string", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					auto_detect: "true",
					duration: "30",
				} as any,
				partial: false,
			}

			await handler.execute(mockTaskConfig, block)

			const cmd = mockExecuteCommandTool.firstCall.args[0]
			expect(cmd).to.contain("--auto-detect")
			expect(cmd).to.contain("--capture")
		})

		it("should NOT include --auto-detect flag when auto_detect is 'false' string", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					auto_detect: "false",
					port: "/dev/ttyACM0",
					duration: "30",
				} as any,
				partial: false,
			}

			await handler.execute(mockTaskConfig, block)

			const cmd = mockExecuteCommandTool.firstCall.args[0]
			expect(cmd).to.not.contain("--auto-detect")
		})

		it("should include --auto-detect for RTT with auto_detect", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: ClineDefaultTool.NORDIC_ACTION,
				params: {
					action: "log_device",
					operation: "capture",
					transport: "rtt",
					auto_detect: "true",
					duration: "60",
				} as any,
				partial: false,
			}

			await handler.execute(mockTaskConfig, block)

			const cmd = mockExecuteCommandTool.firstCall.args[0]
			expect(cmd).to.contain("rtt-logger")
			expect(cmd).to.contain("--capture")
			expect(cmd).to.contain("--auto-detect")
			expect(cmd).to.contain("--duration 60")
		})
	})
})
