import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { parseAssistantMessageV2 } from "../index"

// Bug report: a model (glm-5-turbo / glm-5.2 via zai-coding-plan, XML tool-call path) emitted a
// replace_in_file call whose <path> was a Windows absolute path
//   c:\Users\omarm\Desktop\ncs-projects\ble-bridge\boards\nrf52840dk_nrf52840.overlay
// and the tool result came back labelled "[replace_in_file for 'c']" with an empty
// <file_content path="c"></file_content> — i.e. block.params.path had been truncated to the single
// character "c", losing everything from the drive-letter colon onward.
//
// This file feeds parseAssistantMessageV2 a realistic assistant message containing that exact call
// (plus forward-slash, UNC, spaced, and POSIX variants) and asserts params.path survives intact.
//
// RESULT OF THIS INVESTIGATION: every variant below parses correctly. parseAssistantMessageV2 does not
// split, YAML-parse, or otherwise treat "<word>:" specially anywhere in its state machine — param values
// are extracted purely via literal `</${paramName}>` substring matching (see parse-assistant-message.ts
// lines 56-77), which has no opinion about colons. The DSML pre-pass, literal-template-mimicry pre-pass,
// and code-fence stripper (normalize-assistant-message.ts) are also exercised here (via the "gated"
// describe block below) and do not touch these calls, because none of their trigger substrings
// ("DSML", "<tool_name>", "```") are present in a plain, well-formed <path>...</path> call.
// A char-by-char streaming simulation (growing the message one character at a time, mirroring
// `assistantMessage += chunk.text; parseAssistantMessageV2(assistantMessage)` in src/core/task/index.ts)
// also shows params.path is monotonically correct at every prefix length — no transient state leaks
// into the final (partial:false) parse.
//
// This does NOT reproduce the bug. See the accompanying report for what else was ruled out
// (native tool-calling delta path, apply_patch adapter, workspace-hint "@ws:path" parser, toPosix()).

function findToolUse(message: string, toolName = "replace_in_file") {
	const blocks = parseAssistantMessageV2(message)
	return blocks.find((b) => b.type === "tool_use" && (b as any).name === toolName) as any
}

function replaceInFileMessage(path: string): string {
	return `I'll fix the overlay file now.

<replace_in_file>
<path>${path}</path>
<diff>
------- SEARCH
foo
=======
bar
+++++++ REPLACE
</diff>
</replace_in_file>`
}

describe("replace_in_file <path> survives intact for every path shape", () => {
	test("Windows absolute path with backslashes (the exact reported call)", () => {
		const winPath = "c:\\Users\\omarm\\Desktop\\ncs-projects\\ble-bridge\\boards\\nrf52840dk_nrf52840.overlay"
		const tool = findToolUse(replaceInFileMessage(winPath))
		assert.ok(tool, "expected a replace_in_file tool_use block")
		assert.equal(tool.partial, false)
		assert.equal(tool.params.path, winPath)
		// The specific regression: the drive letter + colon must not be dropped, leaving just "c".
		assert.notEqual(tool.params.path, "c")
	})

	test("Windows path with forward slashes", () => {
		const p = "c:/Users/omarm/Desktop/ncs-projects/ble-bridge/boards/nrf52840dk_nrf52840.overlay"
		const tool = findToolUse(replaceInFileMessage(p))
		assert.equal(tool.params.path, p)
	})

	test("UNC path", () => {
		const p = "\\\\server\\share\\f.c"
		const tool = findToolUse(replaceInFileMessage(p))
		assert.equal(tool.params.path, p)
	})

	test("path with spaces", () => {
		const p = "c:\\Users\\omar morceli\\My Projects\\ble bridge\\boards\\nrf52840dk_nrf52840.overlay"
		const tool = findToolUse(replaceInFileMessage(p))
		assert.equal(tool.params.path, p)
	})

	test("POSIX path", () => {
		const p = "/home/omar/ncs-projects/ble-bridge/boards/nrf52840dk_nrf52840.overlay"
		const tool = findToolUse(replaceInFileMessage(p))
		assert.equal(tool.params.path, p)
	})
})

describe("Windows path survives normalizeAssistantMessage pre-passes too", () => {
	// Exercises the DSML rewrite, literal-template-mimicry rewrite, and code-fence stripper that run
	// inside parseAssistantMessageV2 before the main scan (see normalizeAssistantMessage). None of them
	// should be triggered by (or corrupt) a plain <path> call, but verify explicitly rather than assume.
	const winPath = "c:\\Users\\omarm\\Desktop\\ncs-projects\\ble-bridge\\boards\\nrf52840dk_nrf52840.overlay"

	test("plain call contains none of the pre-pass trigger substrings", () => {
		const msg = replaceInFileMessage(winPath)
		assert.ok(!msg.includes("DSML"), "should not contain DSML trigger")
		assert.ok(!msg.includes("<tool_name>"), "should not contain literal-template trigger")
		assert.ok(!msg.includes("```"), "should not contain code-fence trigger")
	})

	test("wrapped in a ```xml fence (unwrap path), path still intact", () => {
		const msg = "```xml\n" + replaceInFileMessage(winPath) + "\n```"
		const tool = findToolUse(msg)
		assert.ok(tool, "expected the fence to be unwrapped and the tool call parsed")
		assert.equal(tool.params.path, winPath)
	})
})

describe("streaming simulation: char-by-char growth never produces a truncated path at the final parse", () => {
	test("scanning every prefix length, the first partial:false parse has the full path", () => {
		const winPath = "c:\\Users\\omarm\\Desktop\\ncs-projects\\ble-bridge\\boards\\nrf52840dk_nrf52840.overlay"
		const msg = replaceInFileMessage(winPath)

		let sawComplete = false
		let pathAtCompletion: string | undefined

		for (let end = 1; end <= msg.length && !sawComplete; end++) {
			const tool = findToolUse(msg.slice(0, end))
			if (tool && tool.params.path !== undefined && !tool.partial) {
				sawComplete = true
				pathAtCompletion = tool.params.path
			}
		}

		assert.ok(sawComplete, "expected to reach a fully-closed (partial:false) tool_use during the scan")
		assert.equal(pathAtCompletion, winPath)
	})
})
