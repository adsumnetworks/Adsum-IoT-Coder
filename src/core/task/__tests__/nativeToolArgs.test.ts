import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { StreamResponseHandler } from "../StreamResponseHandler"

/**
 * B1 — a model's own close-token, arriving inside a native tool argument.
 *
 * The field report (0.4.0, 10 Sep) caught a `read_file` whose path had the model's DSML close-token
 * and its focus-chain checklist appended to it, three times in one run. The pre-parser that strips
 * those runs on the assistant-MESSAGE path; that run used native tool calling, where the argument
 * arrives as JSON and never passes through it. These cases drive the real handler with the exact
 * shape from the report — no model needed, because the defect is in what we do with the string.
 */
const DSML_CLOSE = "</｜｜DSML｜｜>"

function argue(name: string, input: Record<string, string>): Record<string, string> {
	const toolUseHandler = new StreamResponseHandler().getHandlers().toolUseHandler
	toolUseHandler.processToolUseDelta({ id: "t1", type: "tool_use", name, input: JSON.stringify(input) }, "call-1")
	const [use] = toolUseHandler.getPartialToolUsesAsContent()
	return (use?.params ?? {}) as Record<string, string>
}

describe("a native tool argument carrying the model's own tokens", () => {
	it("is cleaned of the close-token and everything the model appended after it", () => {
		const params = argue("read_file", {
			path: `c:/dev/gw/iot-knowledge/products/fanstel/lew840x/beats/b0-pitch.md${DSML_CLOSE}\n- [ ] Step 1/7: Load b0-pitch.md and run B0\n`,
		})
		assert.equal(params.path, "c:/dev/gw/iot-knowledge/products/fanstel/lew840x/beats/b0-pitch.md")
		assert.ok(!params.path.includes("DSML"), "the close-token must not survive into a path")
		assert.ok(!params.path.includes("Step 1/7"), "and nor must the checklist it dragged along")
	})

	it("cleans the same token out of any argument, not just a path", () => {
		const params = argue("execute_command", { command: `west build -b nrf9151dk${DSML_CLOSE}- [ ] next` })
		assert.equal(params.command, "west build -b nrf9151dk")
	})

	it("leaves a legitimate argument exactly as the model sent it", () => {
		// Angle brackets, pipes, a full-width character and a newline — all legal, none of them the token.
		const honest = {
			path: "src/generated/<template>/ｦpipe｜name/file.md",
			content: "line one\nline two | piped <tag> ｜ full-width pipe\n",
		}
		const params = argue("write_to_file", honest)
		assert.equal(params.path, honest.path)
		assert.equal(params.content, honest.content)
	})
})
