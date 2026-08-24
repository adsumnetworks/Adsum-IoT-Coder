import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"

/**
 * Every advertised tool must be findable by the name its Knowledge bits use.
 *
 * A bit says "use the `posture-scan` Tool bit when it is advertised in the Device tools block", and gives a
 * manual fallback for when it is not. That contract only works if the block actually contains the string
 * `posture-scan`. It did not: the line opened with the resolved command, which for a node tool is an
 * absolute interpreter path ending in `posture_scan.mjs` — underscored, extensioned, and preceded by a node
 * path — with no summary when the descriptor carries none. The tool was advertised and unfindable, so the
 * agent took the fallback and hand-rolled the search the tool exists to replace.
 *
 * This guards the shape at the source rather than the one tool: the renderer must emit each tool's `name`.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/prompts/system-prompt/components/deviceToolsNaming.node-test.ts
 */
const SRC = fs.readFileSync(path.join(__dirname, "iot_context.ts"), "utf8")

describe("device tools advertisement", () => {
	test("the rendered line leads with the tool name", () => {
		const fn = SRC.slice(SRC.indexOf("function renderDeviceTools"), SRC.indexOf("async function buildIotContextTemplateText"))
		assert.ok(fn.length > 0, "renderDeviceTools moved — this test cannot see it")
		assert.match(
			fn,
			/out \+= `- \*\*\$\{t\.name\}\*\*/,
			"the advertisement must open with ${t.name}: a bit that names a tool cannot find it in a bare interpreter path",
		)
	})

	test("the command itself is still rendered, not replaced by the name", () => {
		const fn = SRC.slice(SRC.indexOf("function renderDeviceTools"), SRC.indexOf("async function buildIotContextTemplateText"))
		assert.match(fn, /\$\{t\.command\}\$\{usage\}/, "the agent still needs the exact command it is promised it may run")
	})

	test("a tool whose prerequisite is missing still says so in the line", () => {
		// Naming the tool must not displace the reason it cannot run: an agent that knows "modem-trace needs
		// nrfutil, not found" tells the developer, whereas one that sees a bare name tries and fails.
		const fn = SRC.slice(SRC.indexOf("function renderDeviceTools"), SRC.indexOf("async function buildIotContextTemplateText"))
		assert.match(fn, /t\.unavailable/, "the unavailable reason must survive in the advertisement")
	})
})
