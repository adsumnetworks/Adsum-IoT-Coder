import { expect } from "chai"
import { describe, it } from "mocha"
import { normalizeAssistantMessage } from "../normalize-assistant-message"
import { parseAssistantMessageV2 } from "../parse-assistant-message"

// Fullwidth pipe character used by DeepSeek DSML tokens.
const P = "｜"
const DSML_TC_OPEN = `<${P}${P}DSML${P}${P}tool_calls>`
const DSML_TC_CLOSE = `</${P}${P}DSML${P}${P}tool_calls>`
const dsmlInvoke = (name: string, body: string) =>
	`<${P}${P}DSML${P}${P}invoke name="${name}">${body}</${P}${P}DSML${P}${P}invoke>`
const dsmlParam = (name: string, value: string) =>
	`<${P}${P}DSML${P}${P}parameter name="${name}" string="true">${value}</${P}${P}DSML${P}${P}parameter>`

describe("normalizeAssistantMessage", () => {
	describe("DSML rewriting", () => {
		it("rewrites a simple DSML invoke with one parameter into Cline XML", () => {
			const input = DSML_TC_OPEN + dsmlInvoke("read_file", dsmlParam("path", "/tmp/x.md")) + DSML_TC_CLOSE
			const out = normalizeAssistantMessage(input)
			expect(out).to.equal("<read_file><path>/tmp/x.md</path></read_file>")
		})

		it("rewrites the ask_followup_question case from the bug report (multiple params, including task_progress)", () => {
			const body =
				dsmlParam("question", "Pick BLE debugging options") +
				dsmlParam("options", '["A","B","Skip"]') +
				dsmlParam("task_progress", "- [x] Step 1\n- [ ] Step 2")
			const input = DSML_TC_OPEN + dsmlInvoke("ask_followup_question", body) + DSML_TC_CLOSE
			const out = normalizeAssistantMessage(input)
			expect(out).to.equal(
				"<ask_followup_question>" +
					"<question>Pick BLE debugging options</question>" +
					'<options>["A","B","Skip"]</options>' +
					"<task_progress>- [x] Step 1\n- [ ] Step 2</task_progress>" +
					"</ask_followup_question>",
			)
		})

		it('handles a DSML parameter without the string="true" attribute', () => {
			const param = `<${P}${P}DSML${P}${P}parameter name="path">/etc/hosts</${P}${P}DSML${P}${P}parameter>`
			const input = dsmlInvoke("read_file", param)
			const out = normalizeAssistantMessage(input)
			expect(out).to.equal("<read_file><path>/etc/hosts</path></read_file>")
		})

		it("leaves unknown tool names alone (no silent relabel)", () => {
			const input = dsmlInvoke("totally_made_up_tool", dsmlParam("path", "/x"))
			const out = normalizeAssistantMessage(input)
			expect(out).to.include("totally_made_up_tool")
			expect(out).to.not.include("<totally_made_up_tool>")
		})

		it("leaves unknown parameter names alone", () => {
			const param = `<${P}${P}DSML${P}${P}parameter name="nope_not_real" string="true">v</${P}${P}DSML${P}${P}parameter>`
			const input = dsmlInvoke("read_file", param)
			const out = normalizeAssistantMessage(input)
			expect(out).to.not.include("<nope_not_real>")
			expect(out).to.include("nope_not_real")
		})

		it("is idempotent — re-running on normalized output is a no-op", () => {
			const input = DSML_TC_OPEN + dsmlInvoke("read_file", dsmlParam("path", "/x")) + DSML_TC_CLOSE
			const once = normalizeAssistantMessage(input)
			const twice = normalizeAssistantMessage(once)
			expect(twice).to.equal(once)
		})

		it("does not rewrite a partial DSML invoke missing its close tag (stream mid-flight)", () => {
			const partial = `<${P}${P}DSML${P}${P}invoke name="read_file"><${P}${P}DSML${P}${P}parameter name="path" string="true">/x`
			const out = normalizeAssistantMessage(partial)
			expect(out).to.equal(partial)
		})
	})

	describe("markdown code-fence stripping around tool calls", () => {
		it("unwraps a tool call inside a ```xml fence", () => {
			const input = "Sure, here:\n```xml\n<read_file>\n<path>/etc/hosts</path>\n</read_file>\n```"
			const out = normalizeAssistantMessage(input)
			expect(out).to.include("<read_file>")
			expect(out).to.not.include("```")
		})

		it("unwraps a tool call inside an unlabeled fence", () => {
			const input = "```\n<read_file>\n<path>/x</path>\n</read_file>\n```"
			const out = normalizeAssistantMessage(input)
			expect(out).to.not.include("```")
			expect(out).to.include("<read_file>")
		})

		it("leaves a non-tool code fence untouched", () => {
			const input = "Here is python:\n```python\ndef foo():\n    return 1\n```\nDone."
			const out = normalizeAssistantMessage(input)
			expect(out).to.equal(input)
		})
	})

	describe("literal-template mimicry (placeholder tag names)", () => {
		it("rewrites the exact bug-report payload (matched <tool_name>...</tool_name> close)", () => {
			const input =
				"<tool_name>read_file</tool_name>\n" +
				"<parameter_name>path>/mnt/log-generator.md</parameter_name>\n" +
				"<parameter_name>task_progress>\n- [ ] Load Log Generator Workflow\n- [ ] Analyze project configuration\n</parameter_name>\n" +
				"</tool_name>"
			const out = normalizeAssistantMessage(input)
			expect(out).to.include("<read_file>")
			expect(out).to.include("<path>/mnt/log-generator.md</path>")
			expect(out).to.include("<task_progress>")
			expect(out).to.include("- [ ] Load Log Generator Workflow")
			expect(out).to.include("</read_file>")
			expect(out).to.not.include("<tool_name>")
			expect(out).to.not.include("<parameter_name>")
		})

		it("rewrites the second bug-report payload (mismatched </parameter_name> close on first block)", () => {
			const input =
				"<tool_name>read_file</parameter_name>\n" +
				"<parameter_name>path>/mnt/log-generator.md</parameter_name>\n" +
				"<parameter_name>task_progress>- [ ] Load workflow</parameter_name>\n" +
				"</tool_name>"
			const out = normalizeAssistantMessage(input)
			expect(out).to.include("<read_file>")
			expect(out).to.include("<path>/mnt/log-generator.md</path>")
			expect(out).to.include("<task_progress>- [ ] Load workflow</task_progress>")
			expect(out).to.include("</read_file>")
			expect(out).to.not.include("<tool_name>")
		})

		it("leaves the block alone when the tool name is unknown", () => {
			const input =
				"<tool_name>totally_fake_tool</tool_name>\n" + "<parameter_name>path>/x</parameter_name>\n" + "</tool_name>"
			const out = normalizeAssistantMessage(input)
			expect(out).to.equal(input)
		})

		it("leaves the block alone when any parameter name is unknown", () => {
			const input =
				"<tool_name>read_file</tool_name>\n" + "<parameter_name>not_a_real_param>v</parameter_name>\n" + "</tool_name>"
			const out = normalizeAssistantMessage(input)
			expect(out).to.equal(input)
		})

		it("is idempotent on already-normalized output", () => {
			const input = "<tool_name>read_file</tool_name>\n" + "<parameter_name>path>/x</parameter_name>\n" + "</tool_name>"
			const once = normalizeAssistantMessage(input)
			const twice = normalizeAssistantMessage(once)
			expect(twice).to.equal(once)
		})

		it("does not rewrite a partial block missing its trailing </tool_name>", () => {
			const partial = "<tool_name>read_file</tool_name>\n<parameter_name>path>/x</parameter_name>"
			expect(normalizeAssistantMessage(partial)).to.equal(partial)
		})
	})

	describe("fast path / no-op", () => {
		it("returns plain text unchanged", () => {
			const input = "Hello — no tools here."
			expect(normalizeAssistantMessage(input)).to.equal(input)
		})

		it("returns canonical XML unchanged", () => {
			const input = "<read_file><path>/x</path></read_file>"
			expect(normalizeAssistantMessage(input)).to.equal(input)
		})

		it("handles empty string", () => {
			expect(normalizeAssistantMessage("")).to.equal("")
		})
	})
})

describe("parseAssistantMessageV2 (with normalization integrated)", () => {
	it("parses a DSML-encoded read_file as a real tool_use block", () => {
		const input =
			"Loading the workflow." +
			DSML_TC_OPEN +
			dsmlInvoke("read_file", dsmlParam("path", "/tmp/workflow.md")) +
			DSML_TC_CLOSE
		const blocks = parseAssistantMessageV2(input)
		const tools = blocks.filter((b) => b.type === "tool_use")
		expect(tools).to.have.length(1)
		const tool = tools[0] as Extract<(typeof blocks)[number], { type: "tool_use" }>
		expect(tool.name).to.equal("read_file")
		expect(tool.params.path).to.equal("/tmp/workflow.md")
		expect(tool.partial).to.equal(false)
	})

	it("parses a literal-template-mimic read_file as a real tool_use block", () => {
		const input =
			"I'll load the workflow.\n\n" +
			"<tool_name>read_file</tool_name>\n" +
			"<parameter_name>path>/tmp/workflow.md</parameter_name>\n" +
			"<parameter_name>task_progress>- [ ] Step 1</parameter_name>\n" +
			"</tool_name>"
		const blocks = parseAssistantMessageV2(input)
		const tools = blocks.filter((b) => b.type === "tool_use")
		expect(tools).to.have.length(1)
		const tool = tools[0] as Extract<(typeof blocks)[number], { type: "tool_use" }>
		expect(tool.name).to.equal("read_file")
		expect(tool.params.path).to.equal("/tmp/workflow.md")
		expect(tool.params.task_progress).to.equal("- [ ] Step 1")
		expect(tool.partial).to.equal(false)
	})

	it("parses a fenced ask_followup_question as a real tool_use block", () => {
		const input =
			"Here:\n```xml\n<ask_followup_question>\n" +
			"<question>Pick one</question>\n" +
			'<options>["A","B"]</options>\n' +
			"</ask_followup_question>\n```"
		const blocks = parseAssistantMessageV2(input)
		const tools = blocks.filter((b) => b.type === "tool_use")
		expect(tools).to.have.length(1)
		const tool = tools[0] as Extract<(typeof blocks)[number], { type: "tool_use" }>
		expect(tool.name).to.equal("ask_followup_question")
		expect(tool.params.question).to.equal("Pick one")
		expect(tool.params.options).to.equal('["A","B"]')
	})
})
