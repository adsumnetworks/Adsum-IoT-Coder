import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { nativeToolCorrection } from "./UseMcpToolHandler"

/**
 * F5 2247 regression: the free-tier model wrapped native triggerCveScan in a use_mcp_tool envelope
 * (invented server = the extension id, then the tool name AS the server) and dead-ended the CRA sample.
 * The intercept returns this corrective error BEFORE any approval card renders.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/task/tools/handlers/useMcpNativeIntercept.test.ts
 */
describe("nativeToolCorrection (use_mcp_tool → native tool teach-back)", () => {
	test("maps the model's own JSON arguments into the exact native XML call", () => {
		const msg = nativeToolCorrection("triggerCveScan", '{"sbom":"compliance/sbom/all.spdx","build":"build"}')
		assert.match(msg, /BUILT-IN tool/)
		assert.match(msg, /<triggerCveScan><sbom>compliance\/sbom\/all\.spdx<\/sbom><build>build<\/build><\/triggerCveScan>/)
		assert.match(msg, /not an MCP tool/)
	})
	test("malformed JSON still teaches the syntax with a placeholder", () => {
		const msg = nativeToolCorrection("triggerNordicAction", "{not json")
		assert.match(msg, /<triggerNordicAction><param>value<\/param><\/triggerNordicAction>/)
	})
	test("no arguments → placeholder param", () => {
		const msg = nativeToolCorrection("triggerEspAction", undefined)
		assert.match(msg, /<triggerEspAction><param>value<\/param><\/triggerEspAction>/)
	})
})
