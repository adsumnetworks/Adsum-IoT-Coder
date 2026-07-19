import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseAssistantMessageV2 } from "../index"
import { readProjectIdfVersionFromLock } from "@/services/esp/EspEnvironmentDetector"

// Omar's exact tool call from run 1784481678488 — passed in 12 of 15 calls, silently dropped by the parser.
const OMAR_CALL = `<triggerEspAction>
<action>build</action>
<idf_version>5.5.4</idf_version>
</triggerEspAction>`

describe("idf_version reaches the handler (field run 1784481678488)", () => {
	test("the parser keeps <idf_version> instead of silently dropping it", () => {
		const blocks = parseAssistantMessageV2(OMAR_CALL)
		const tool = blocks.find((b) => b.type === "tool_use") as any
		assert.ok(tool, "expected a tool_use block")
		assert.equal(tool.name, "triggerEspAction")
		assert.equal(tool.params.action, "build")
		// THE bug: this was undefined because idf_version was missing from toolParamNames — the prompt
		// documented it, the model passed it, the parser stripped it. Same lesson as ncs_version, learned twice.
		assert.equal(tool.params.idf_version, "5.5.4")
	})

	test("ncs_version (the documented twin) still parses too", () => {
		const blocks = parseAssistantMessageV2(`<triggerNordicAction>\n<action>build</action>\n<ncs_version>3.3.1</ncs_version>\n</triggerNordicAction>`)
		const tool = blocks.find((b) => b.type === "tool_use") as any
		assert.equal(tool.params.ncs_version, "3.3.1")
	})
})

describe("lock discovery at field depth (workspace root = Desktop)", () => {
	const LOCK = "dependencies:\n  idf:\n    source:\n      type: idf\n    version: 5.5.4\n"

	test("finds dependencies.lock two levels below the root", () => {
		const root = mkdtempSync(join(tmpdir(), "desk-"))
		try {
			// Desktop/bwg840-gateway/esp-gateway/dependencies.lock — the real layout that was invisible.
			const proj = join(root, "bwg840-gateway", "esp-gateway")
			mkdirSync(proj, { recursive: true })
			writeFileSync(join(proj, "dependencies.lock"), LOCK)
			assert.equal(readProjectIdfVersionFromLock([root]), "5.5.4")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("does not descend into build/ or hidden dirs (stays cheap + avoids stale locks)", () => {
		const root = mkdtempSync(join(tmpdir(), "desk-"))
		try {
			const buried = join(root, "proj", "build", "something")
			mkdirSync(buried, { recursive: true })
			writeFileSync(join(buried, "dependencies.lock"), LOCK)
			assert.equal(readProjectIdfVersionFromLock([root]), undefined)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test("depth-1 layout (project at workspace root) still works", () => {
		const root = mkdtempSync(join(tmpdir(), "desk-"))
		try {
			writeFileSync(join(root, "dependencies.lock"), LOCK)
			assert.equal(readProjectIdfVersionFromLock([root]), "5.5.4")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
