import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { applyMcpPromptCommand, McpPromptSource, parseMcpPromptToken } from "./mcpPromptCommand"

/**
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/slash-commands/mcpPromptCommand.test.ts
 */
describe("parseMcpPromptToken — the /mcp:<server>:<prompt> token", () => {
	test("parses server and prompt name", () => {
		const parsed = parseMcpPromptToken("please run /mcp:nordic:flash-checklist now")
		assert.ok(parsed)
		assert.equal(parsed.serverName, "nordic")
		assert.equal(parsed.promptName, "flash-checklist")
		assert.equal(parsed.token, "/mcp:nordic:flash-checklist")
	})

	test("is null when there is no mcp token", () => {
		assert.equal(parseMcpPromptToken("just a normal message, no slash here"), null)
	})

	test("a plain slash command is not an mcp prompt token", () => {
		assert.equal(parseMcpPromptToken("/newtask please"), null)
	})
})

describe("applyMcpPromptCommand — substitution against a stubbed hub", () => {
	test("replaces the token with the fetched prompt text", async () => {
		const stub: McpPromptSource = {
			getPrompt: async (serverName, promptName) => {
				assert.equal(serverName, "nordic")
				assert.equal(promptName, "flash-checklist")
				return "1. Erase. 2. Program. 3. Reset."
			},
		}
		const result = await applyMcpPromptCommand("before /mcp:nordic:flash-checklist after", stub)
		assert.equal(result, "before 1. Erase. 2. Program. 3. Reset. after")
	})

	test("leaves the text unchanged when there is no token", async () => {
		const stub: McpPromptSource = { getPrompt: async () => "should not be called" }
		const result = await applyMcpPromptCommand("nothing to resolve here", stub)
		assert.equal(result, "nothing to resolve here")
	})

	test("degrades to the literal token when the hub has nothing to offer", async () => {
		const stub: McpPromptSource = { getPrompt: async () => undefined }
		const text = "run /mcp:nordic:missing please"
		assert.equal(await applyMcpPromptCommand(text, stub), text)
	})

	test("degrades to the literal token when the hub throws", async () => {
		const stub: McpPromptSource = {
			getPrompt: async () => {
				throw new Error("server unreachable")
			},
		}
		const text = "run /mcp:nordic:flaky please"
		assert.equal(await applyMcpPromptCommand(text, stub), text)
	})
})
