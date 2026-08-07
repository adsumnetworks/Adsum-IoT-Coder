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

test("every variant config advertises UPDATE_MEMORY — the tool was dead because NO variant listed it", () => {
	// The project-memory tool had a spec and a registered handler but appeared in zero `.tools(...)`
	// lists, so no model ever saw it. Same silent-drop failure mode as CVE_SCAN above; pinned the same way.
	const dirs = readdirSync(VARIANTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())
	let checked = 0
	for (const d of dirs) {
		let content: string
		try {
			content = readFileSync(path.join(VARIANTS_DIR, d.name, "config.ts"), "utf8")
		} catch {
			continue
		}
		if (content.includes("ClineDefaultTool.ESP_ACTION")) {
			assert.ok(
				content.includes("ClineDefaultTool.UPDATE_MEMORY"),
				`variant '${d.name}' advertises the device tools but is missing UPDATE_MEMORY`,
			)
			checked++
		}
	}
	assert.ok(checked >= 10, `expected ≥10 variant configs to carry UPDATE_MEMORY, found ${checked}`)
})

test("update_project_memory is fully wired: enum, spec registration, handler, and params", () => {
	assert.match(read("src/shared/tools.ts"), /UPDATE_MEMORY\s*=\s*"update_project_memory"/)
	const init = read("src/core/prompts/system-prompt/tools/init.ts")
	assert.match(init, /import\s*\{\s*update_project_memory_variants\s*\}/)
	assert.match(init, /\.\.\.update_project_memory_variants/)
	assert.match(read("src/core/task/ToolExecutor.ts"), /new UpdateProjectMemoryHandler\(/)
	// The tool is SECTION-SCOPED as of Wave 3: target/op/id/content replaced the old whole-file
	// `filename` clobber, so the model can no longer overwrite host-detected sections wholesale.
	// Params must be in toolParamNames or the XML parser silently drops them.
	const paramList = read("src/core/assistant-message/index.ts")
	const declared = read("src/core/prompts/system-prompt/tools/update_project_memory.ts")
	for (const p of ["target", "op", "id", "content"]) {
		assert.match(declared, new RegExp(`name:\\s*"${p}"`), `update_project_memory spec should declare param '${p}'`)
		assert.match(paramList, new RegExp(`["']${p}["']`), `toolParamNames must include '${p}' or the parser drops <${p}>`)
	}
	assert.ok(!/name:\s*"filename"/.test(declared), "the old whole-file `filename` param must be gone")
})

test("project memory is read back into the prompt from the WORKSPACE (.adsum), not globalStorage", () => {
	// Both ends must be live: the tool writes memory, this injects it back. Wave 3 moved the store
	// into the workspace so it is git-trackable, inspectable, and survives a folder move -- the
	// md5(cwd) globalStorage layout orphaned itself when a real project folder was moved.
	const ctx = read("src/core/prompts/system-prompt/components/iot_context.ts")
	assert.match(ctx, /^\s*import \{ readMapMd, readProjectMd \}/m, "the workspace store import must be live")
	assert.match(ctx, /buildProjectMemorySection\(cwd\)/, "the Tier A memory block must be appended")
	assert.match(ctx, /migrateLegacyMemory\(cwd\)/, "legacy globalStorage memory must be migrated once")
})

test("TIER SPLIT: volatile memory must NOT be in the prompt fingerprint", () => {
	// The load-bearing invariant. PROJECT.md / MAP.md are host-written and change only with the
	// workspace, so they belong in the cached system prompt. status.json / session.json change
	// constantly; if they were fingerprinted, every defect note would force a ~46K-token prompt
	// rebuild. They ride on the last user message instead (tailBlock.ts).
	const ctx = read("src/core/prompts/system-prompt/components/iot_context.ts")
	assert.match(ctx, /adsum:PROJECT\.md=/, "PROJECT.md must be fingerprinted")
	assert.match(ctx, /adsum:MAP\.md=/, "MAP.md must be fingerprinted")
	assert.ok(!/status\.json=/.test(ctx), "status.json must NOT be fingerprinted (Tier B)")
	assert.ok(!/session\.json=/.test(ctx), "session.json must NOT be fingerprinted (Tier B)")
	assert.match(read("src/core/task/index.ts"), /withProjectStateTail\(/, "Tier B must be applied before the API call")
})

test("memory write rules are enforced: host-owned sections, evidence, and junk rejected", () => {
	const rules = read("src/core/memory/workspace/writeRules.ts")
	// A model may not overwrite what the host detects from live hardware/config.
	assert.match(rules, /hw-detected|HOST_OWNED/, "host-owned sections must be rejected")
	// A defect claim without a path:line is unfalsifiable, and pasted logs are what bloated memory.
	assert.match(rules, /evidence/i, "defect writes must require evidence")
	assert.match(rules, /verified/, "verified must be host-stamped, not model-set")
})

test("memory size caps exist and are applied on both the write and inject paths", () => {
	// Unbounded memory would inflate EVERY system prompt for the workspace forever.
	const limits = read("src/core/memory/memoryLimits.ts")
	assert.match(limits, /MEMORY_INJECT_CAP\s*=\s*6000/)
	assert.match(limits, /MEMORY_WRITE_CAP\s*=\s*24000/)
	assert.match(read("src/core/memory/workspace/render.ts"), /PROJECT_MD_CAP\s*=\s*4096/, "PROJECT.md is capped")
	assert.match(read("src/core/memory/workspace/render.ts"), /TAIL_BLOCK_CAP\s*=\s*1600/, "the tail block is capped")
})

test("a successful memory write reports the ABSOLUTE path so the model can read it back later", () => {
	// The write path is: handler -> applyMemoryWrite (writeApply.ts), which builds the result text.
	// The model cannot guess where memory lives, so every success must name the file it wrote.
	const apply = read("src/core/memory/workspace/writeApply.ts")
	assert.match(apply, /Written to: \$\{absPath\}/, "the success result must name the absolute file written")
	assert.match(
		read("src/core/task/tools/handlers/UpdateProjectMemoryHandler.ts"),
		/applyMemoryWrite\(config\.cwd/,
		"the handler must route writes through applyMemoryWrite",
	)
})

test("read_file's optional line window (start_line/end_line) is declared on EVERY variant and registered for XML parsing", () => {
	// Without the toolParamNames entries the parser drops <start_line>/<end_line> and every ranged read
	// silently becomes a whole-file read — the exact waste the params exist to remove (measured: a
	// 69,739-char sdkconfig read whole after search_files had already found the 570-char answer).
	const declared = read("src/core/prompts/system-prompt/tools/read_file.ts")
	const paramList = read("src/core/assistant-message/index.ts")
	for (const p of ["start_line", "end_line"]) {
		assert.match(declared, new RegExp(`name:\\s*"${p}"`), `read_file spec should declare param '${p}'`)
		assert.match(paramList, new RegExp(`["']${p}["']`), `toolParamNames must include '${p}' or the parser drops <${p}>`)
	}
	// Both params must ride on all three variants (generic + the two native ones) or native-mode models
	// get a JSON schema without them.
	const variantParamBlocks = declared.match(/START_LINE_PARAMETER,\s*\n\s*END_LINE_PARAMETER,/g) ?? []
	assert.ok(
		variantParamBlocks.length >= 2,
		`start_line/end_line must be listed in every read_file variant's parameters (found ${variantParamBlocks.length})`,
	)
	// The handler must actually apply the window, and the fold must still run last.
	const handler = read("src/core/task/tools/handlers/ReadFileToolHandler.ts")
	assert.match(handler, /sliceLineRange\(bodyText, block\.params\.start_line, block\.params\.end_line\)/)
	assert.match(handler, /return capFileContentForContext\(bodyText, absolutePath\)/)
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
