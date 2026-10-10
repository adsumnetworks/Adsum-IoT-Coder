import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { APPROVAL_ASK_TYPES, autoApproveActionFor } from "../autoApproveAction"

const ask = (askType: ClineMessage["ask"], text = ""): ClineMessage => ({ ts: 1, type: "ask", ask: askType, text })
const tool = (toolName: string) => ask("tool", JSON.stringify({ tool: toolName }))

describe("autoApproveActionFor", () => {
	it("maps a command ask to executeAllCommands", () => {
		expect(autoApproveActionFor(ask("command", "rm -rf build"))).toBe("executeAllCommands")
	})

	it("maps a browser launch ask to useBrowser", () => {
		expect(autoApproveActionFor(ask("browser_action_launch"))).toBe("useBrowser")
	})

	it("maps an MCP ask to useMcp", () => {
		expect(autoApproveActionFor(ask("use_mcp_server"))).toBe("useMcp")
	})

	it("maps a read-like tool to readFiles", () => {
		expect(autoApproveActionFor(tool("readFile"))).toBe("readFiles")
		expect(autoApproveActionFor(tool("searchFiles"))).toBe("readFiles")
	})

	it("maps an edit-like tool to editFiles", () => {
		expect(autoApproveActionFor(tool("newFileCreated"))).toBe("editFiles")
	})

	it("maps an embedded-action tool to executeAllCommands", () => {
		expect(autoApproveActionFor(tool("triggerNordicAction"))).toBe("executeAllCommands")
	})

	it("returns undefined for an unmapped tool kind", () => {
		expect(autoApproveActionFor(tool("webSearch"))).toBeUndefined()
	})

	it("returns undefined for malformed tool JSON rather than throwing", () => {
		expect(autoApproveActionFor(ask("tool", "not json"))).toBeUndefined()
	})

	it("returns undefined for an ask outside the approval set, e.g. a question", () => {
		expect(autoApproveActionFor(ask("followup", "which board?"))).toBeUndefined()
	})

	it("lists exactly the permission-style asks as approval rows", () => {
		expect(APPROVAL_ASK_TYPES.has("tool")).toBe(true)
		expect(APPROVAL_ASK_TYPES.has("command")).toBe(true)
		expect(APPROVAL_ASK_TYPES.has("browser_action_launch")).toBe(true)
		expect(APPROVAL_ASK_TYPES.has("use_mcp_server")).toBe(true)
		expect(APPROVAL_ASK_TYPES.has("followup")).toBe(false)
		expect(APPROVAL_ASK_TYPES.has("completion_result")).toBe(false)
	})
})
