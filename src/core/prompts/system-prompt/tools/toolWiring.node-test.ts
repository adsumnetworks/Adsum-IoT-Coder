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

test("the cve-scan k-bit lives in the backend kbits tree (downloaded) and is referenced by cra-readiness (discoverable)", () => {
	// The CRA bits are downloaded/proprietary → their single home is Adsum-Backend/kbits/, NOT this repo's
	// bundled tree (they must never ship in the Apache VSIX). Verify the wiring against that home. If the
	// backend checkout isn't present (e.g. a code-only CI runner), skip rather than fail — the discoverability
	// invariant is enforced by kbit.test.ts (mapping guard) inside whichever repo holds the bit.
	const BACKEND_KBITS = path.resolve(REPO_ROOT, "../Adsum-Backend/kbits")
	let bit: string
	try {
		bit = readFileSync(path.join(BACKEND_KBITS, "cra/workflows/cve-scan.md"), "utf8")
	} catch {
		console.warn("[tool-wiring] Adsum-Backend/kbits not found — skipping cve-scan placement check")
		return
	}
	assert.match(bit, /id:\s*adsum\/cra\/workflows\/cve-scan/)
	assert.match(bit, /delivery:\s*downloaded/)
	assert.match(
		readFileSync(path.join(BACKEND_KBITS, "cra/workflows/cra-readiness.md"), "utf8"),
		/adsum\/cra\/workflows\/cve-scan/,
	)
})

test("triggerCveScan's params (sbom, build) are registered in toolParamNames — else the parser silently drops them", () => {
	// The assistant-message parser only extracts a tool param if its name is in `toolParamNames`. A tool can be
	// fully wired (handler + spec + variants + enum) yet still fail at runtime with "Missing value for required
	// parameter '<x>'" if the param name was never added here. This bit us live: triggerCveScan received no
	// `sbom` because `sbom`/`build` were absent from the list.
	const paramList = read("src/core/assistant-message/index.ts")
	const declared = read("src/core/prompts/system-prompt/tools/trigger_cve_scan.ts")
	for (const p of ["sbom", "build"]) {
		assert.match(declared, new RegExp(`name:\\s*"${p}"`), `trigger_cve_scan spec should declare param '${p}'`)
		assert.match(paramList, new RegExp(`["']${p}["']`), `toolParamNames must include '${p}' or the parser drops <${p}>`)
	}
})
