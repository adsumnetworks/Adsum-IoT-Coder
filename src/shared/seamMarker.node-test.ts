/**
 * Round 23 (B33): the test seam's marker file is not shown to the agent as part of the project.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json -r tsconfig-paths/register src/shared/seamMarker.node-test.ts
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import "@utils/path" // String.prototype.toPosix, as the extension installs it at load
import { formatResponse } from "@core/prompts/responses"
import { setSeamMarkerHidden } from "./seamMarker"

describe("B33 — the seam's marker is not the developer's project", () => {
	test("M-1 with the seam on, evals.env at the root is left out of the file list; everything else stays", () => {
		const root = "/work/project"
		const files = [`${root}/main.c`, `${root}/evals.env`, `${root}/sub/evals.env`]
		setSeamMarkerHidden(true)
		try {
			const out = formatResponse.formatFilesList(root, files, false)
			assert.ok(!out.split("\n").includes("evals.env"), out)
			assert.ok(out.includes("main.c"))
			assert.ok(out.includes("sub/evals.env"), "only the root marker is the seam's")
		} finally {
			setSeamMarkerHidden(false)
		}
	})

	test("M-2 with the seam off, nothing is hidden", () => {
		const root = "/work/project"
		const out = formatResponse.formatFilesList(root, [`${root}/evals.env`], false)
		assert.ok(out.includes("evals.env"))
	})

	test("M-3 test mode turns the hiding on", () => {
		const src = readFileSync(path.join(__dirname, "../services/test/TestMode.ts"), "utf8")
		assert.match(src, /setSeamMarkerHidden\(value\)/)
	})

	test("M-4 the voice rule covers progress text and never calls the project a scenario or an evaluation", () => {
		const agent = readFileSync(path.join(__dirname, "../../iot-knowledge/AGENT.md"), "utf8")
		assert.match(agent, /every line the developer sees/)
		assert.match(agent, /Never describe the developer's request or project as a scenario, a test, an eval/)
	})
})
