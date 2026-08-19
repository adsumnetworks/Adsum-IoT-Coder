import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { BUTTON_CONFIGS, getButtonConfig } from "./buttonConfig"

describe("getButtonConfig", () => {
	// Test default behavior
	it("returns default config when no task is provided", () => {
		const task = undefined
		const config = getButtonConfig(task)
		expect(config).toEqual(BUTTON_CONFIGS.default)
	})

	// Test streaming/partial messages
	it("returns partial config for streaming messages", () => {
		const streamingMessage: ClineMessage = {
			type: "say",
			say: "api_req_started",
			partial: true,
			ts: Date.now(),
		}
		const config = getButtonConfig(streamingMessage)
		expect(config).toEqual(BUTTON_CONFIGS.partial)
	})

	// Test error recovery states
	describe("Error Recovery States", () => {
		const errorStates = ["api_req_failed", "mistake_limit_reached"]

		errorStates.forEach((errorState) => {
			it(`returns correct config for ${errorState}`, () => {
				const errorMessage: ClineMessage = {
					type: "ask",
					ask: errorState as any,
					partial: true,
					text: "",
					ts: Date.now(),
				}
				const config = getButtonConfig(errorMessage)
				expect(config).toEqual(BUTTON_CONFIGS[errorState])
			})
		})
	})

	// Test tool approval states
	describe("Tool Approval States", () => {
		it("returns tool_approve config for generic tool ask", () => {
			const toolMessage: ClineMessage = {
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "generic_tool" }),
				ts: Date.now(),
			}
			const config = getButtonConfig(toolMessage)
			expect(config).toEqual(BUTTON_CONFIGS.tool_approve)
		})

		it("returns tool_save config for file editing tools", () => {
			const saveMessages = [{ tool: "editedExistingFile" }, { tool: "newFileCreated" }]

			saveMessages.forEach((toolData) => {
				const toolMessage: ClineMessage = {
					type: "ask",
					ask: "tool",
					text: JSON.stringify(toolData),
					ts: Date.now(),
				}
				const config = getButtonConfig(toolMessage)
				expect(config).toEqual(BUTTON_CONFIGS.tool_save)
			})
		})
	})

	// Test command execution states
	describe("Command Execution States", () => {
		it("returns command config for command ask", () => {
			const commandMessage: ClineMessage = {
				type: "ask",
				ask: "command",
				ts: Date.now(),
			}
			const config = getButtonConfig(commandMessage)
			expect(config).toEqual(BUTTON_CONFIGS.command)
		})

		it("returns command_output config for command_output ask", () => {
			const commandOutputMessage: ClineMessage = {
				type: "ask",
				ask: "command_output",
				ts: Date.now(),
			}
			const config = getButtonConfig(commandOutputMessage)
			expect(config).toEqual(BUTTON_CONFIGS.command_output)
		})
	})

	// Test other specific ask states
	describe("Other Ask States", () => {
		const stateConfigs = [
			{ ask: "followup", expectedConfig: "followup" },
			{ ask: "browser_action_launch", expectedConfig: "browser_action_launch" },
			{ ask: "use_mcp_server", expectedConfig: "use_mcp_server" },
			{ ask: "plan_mode_respond", expectedConfig: "plan_mode_respond" },
			{ ask: "completion_result", expectedConfig: "completion_result" },
			{ ask: "resume_task", expectedConfig: "resume_task" },
			{ ask: "resume_completed_task", expectedConfig: "resume_completed_task" },
			{ ask: "new_task", expectedConfig: "new_task" },
			{ ask: "condense", expectedConfig: "condense" },
			{ ask: "report_bug", expectedConfig: "report_bug" },
		]

		stateConfigs.forEach(({ ask, expectedConfig }) => {
			it(`returns ${expectedConfig} config for ${ask} ask`, () => {
				const message: ClineMessage = {
					type: "ask",
					ask: ask as any,
					ts: Date.now(),
				}
				const config = getButtonConfig(message)
				expect(config).toEqual(BUTTON_CONFIGS[expectedConfig])
			})
		})
	})

	// Test API request states
	it("returns api_req_active config for api_req_started say message", () => {
		const apiReqMessage: ClineMessage = {
			type: "say",
			say: "api_req_started",
			ts: Date.now(),
		}
		const config = getButtonConfig(apiReqMessage)
		expect(config).toEqual(BUTTON_CONFIGS.api_req_active)
	})

	// Test mode parameter (though not extensively used in the current implementation)
	it("handles mode parameter without changing core behavior", () => {
		const message: ClineMessage = {
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "generic_tool" }),
			ts: Date.now(),
		}
		const configAct = getButtonConfig(message, "act")
		const configPlan = getButtonConfig(message, "plan")
		expect(configAct).toEqual(configPlan)
	})

	// THE SCAFFOLD HANDOVER. Reported 2026-08-19: the handover rendered "Approve"/"Reject" and clicking did
	// nothing, so the developer opened the folder by hand every time. BUTTON_CONFIGS.open_project was
	// correct; the switch simply had no case for it, so it fell through to `default` (tool_approve).
	//
	// An earlier test asserted the CONFIG OBJECT existed by reading the source as text. It passed for
	// months while the button was dead, because existing and being reachable are different things. These
	// call the real function.
	describe("open_project — the scaffold handover", () => {
		const handover: ClineMessage = {
			type: "ask",
			ask: "open_project",
			text: "C:\Users\omarm\Desktop\cellular_mqtt",
			ts: Date.now(),
		}

		it("is reachable from getButtonConfig at all", () => {
			expect(getButtonConfig(handover)).toEqual(BUTTON_CONFIGS.open_project)
		})

		it("does NOT fall through to Approve/Reject", () => {
			const config = getButtonConfig(handover)
			expect(config).not.toEqual(BUTTON_CONFIGS.tool_approve)
			expect(config.primaryText).toBe("Open project folder")
		})

		it("dispatches the utility action, which is what actually opens the folder", () => {
			// "approve" resolves the ask and lets the run continue with the folder still closed — the exact
			// bug. Only "utility" reaches FileServiceClient.openFolder in useMessageHandlers.
			expect(getButtonConfig(handover).primaryAction).toBe("utility")
		})

		it("offers no second button to get wrong", () => {
			expect(getButtonConfig(handover).secondaryText).toBeUndefined()
		})

		it("leaves typing enabled — a strong default, not a trap", () => {
			expect(getButtonConfig(handover).sendingDisabled).toBe(false)
			expect(getButtonConfig(handover).enableButtons).toBe(true)
		})
	})
})
