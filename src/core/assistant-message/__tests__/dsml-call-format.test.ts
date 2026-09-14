import { strict as assert } from "node:assert"
import { normalizeAssistantMessage } from "../normalize-assistant-message"
import { parseAssistantMessageV2 } from "../parse-assistant-message"

/**
 * The whole tool-call format, not a stray token in an argument.
 *
 * At a low thinking budget this model writes its calls in its own markup instead of the XML the
 * prompt asks for. The engine sees no tool, says "You did not use a tool in your previous response",
 * the model concludes the parser failed and repeats the identical call, and the session dies on the
 * mistake limit in twenty seconds without executing anything.
 *
 * The block below is VERBATIM from the transcript of that run (task 1789341500200 on the bench,
 * deepseek-v4-flash at 1,024) — including its damage: the marker carries a space before the element
 * name, the wrapper is "calls" and not "tool_calls", and two of the three parameters never close
 * their name attribute (`name="recursive>`), one of them closing with `</task_progress>` instead of
 * the markup's own closing tag. A normaliser that only accepts the tidy form would pass a test and
 * fail this run, so the test uses what the model actually sent.
 */
const FROM_THE_TRANSCRIPT = ` <｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="list_files">
<｜｜DSML｜｜ parameter name="path" string="true">/home/adsum-bench/.vscode-server/extensions/adsumnetwork.nrf-ai-debugger-0.4.0/iot-knowledge/products</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="recursive>true</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="task_progress>
- [ ] Locate the product bit for BLG20x
- [ ] Read the product index (PRODUCT.md)
- [ ] Determine which chip is which
- [ ] Determine which probe goes on which header
</task_progress>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>`

const PATH = "/home/adsum-bench/.vscode-server/extensions/adsumnetwork.nrf-ai-debugger-0.4.0/iot-knowledge/products"

const XML_CALL = `I will look at the tree first.

<list_files>
<path>iot-knowledge/products</path>
<recursive>true</recursive>
</list_files>`

function toolUses(message: string) {
	return parseAssistantMessageV2(normalizeAssistantMessage(message)).filter((b) => b.type === "tool_use") as Array<{
		name: string
		params: Record<string, string>
	}>
}

describe("a tool call written in the model's own markup", () => {
	it("is recognised as the tool it names, with every parameter it carried", () => {
		const uses = toolUses(FROM_THE_TRANSCRIPT)
		assert.equal(uses.length, 1, "the block is one call, and it must be seen as one")
		assert.equal(uses[0].name, "list_files")
		assert.equal(uses[0].params.path, PATH)
		assert.equal(uses[0].params.recursive, "true")
		assert.ok(
			uses[0].params.task_progress?.includes("Locate the product bit for BLG20x"),
			"the checklist is a parameter like any other, not text left in the message",
		)
	})

	it("leaves a proper XML call exactly as it was", () => {
		// Byte for byte: the path every model already takes must not change shape because another
		// dialect exists.
		assert.equal(normalizeAssistantMessage(XML_CALL), XML_CALL)
		const uses = toolUses(XML_CALL)
		assert.equal(uses.length, 1)
		assert.equal(uses[0].name, "list_files")
		assert.equal(uses[0].params.path, "iot-knowledge/products")
	})

	it("prefers the XML call when a response carries both", () => {
		const uses = toolUses(`${XML_CALL}\n\n${FROM_THE_TRANSCRIPT}`)
		assert.equal(uses[0].name, "list_files")
		assert.equal(uses[0].params.path, "iot-knowledge/products", "the XML call is the one that runs")
	})
})
