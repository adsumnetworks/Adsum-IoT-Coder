/**
 * Wiring regression for the CVE scan tool — guards every place the tool must be registered so it can't silently
 * drop out (which would make it invisible to the model without any test failing). Pure fs reads → runs under
 * ts-node via `npm run test:tool-wiring`. Complements the system-prompt snapshot test (CI) which catches the
 * rendered-prompt effect; this pins the source wiring with precise, fast assertions.
 */
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"

const REPO_ROOT = path.resolve(__dirname, "../../../../..")
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8")
const VARIANTS_DIR = path.join(REPO_ROOT, "src/core/prompts/system-prompt/variants")

test("every variant config that advertises the device tools also advertises CVE_SCAN (no silent drop)", () => {
	const dirs = readdirSync(VARIANTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())
	let checked = 0
	for (const d of dirs) {
		const configPath = path.join(VARIANTS_DIR, d.name, "config.ts")
		let content: string
		try {
			content = readFileSync(configPath, "utf8")
		} catch {
			continue
		}
		if (content.includes("ClineDefaultTool.ESP_ACTION")) {
			assert.ok(
				content.includes("ClineDefaultTool.CVE_SCAN"),
				`variant '${d.name}' advertises the device tools but is missing CVE_SCAN`,
			)
			checked++
		}
	}
	assert.ok(checked >= 10, `expected ≥10 variant configs to carry the device+CVE tools, found ${checked}`)
})

test("CVE_SCAN is in the enum (tools.ts) with the wire name 'triggerCveScan'", () => {
	assert.match(read("src/shared/tools.ts"), /CVE_SCAN\s*=\s*"triggerCveScan"/)
})

test("triggerCveScan is in the ExtensionMessage ClineTool union", () => {
	assert.match(read("src/shared/ExtensionMessage.ts"), /"triggerCveScan"/)
})

test("the spec variants are registered in the prompt tool-set (init.ts)", () => {
	const init = read("src/core/prompts/system-prompt/tools/init.ts")
	assert.match(init, /import\s*\{\s*trigger_cve_scan_variants\s*\}/)
	assert.match(init, /\.\.\.trigger_cve_scan_variants/)
})

test("the handler is registered in ToolExecutor (routable)", () => {
	const exec = read("src/core/task/ToolExecutor.ts")
	assert.match(exec, /new TriggerCveScanHandler\(/)
})

test("the cve-scan k-bit is in the corpus and referenced by cra-readiness (discoverable)", () => {
	const bit = read("iot-knowledge/cra/workflows/cve-scan.md")
	assert.match(bit, /id:\s*adsum\/cra\/workflows\/cve-scan/)
	assert.match(bit, /delivery:\s*downloaded/)
	assert.match(read("iot-knowledge/cra/workflows/cra-readiness.md"), /adsum\/cra\/workflows\/cve-scan/)
})
