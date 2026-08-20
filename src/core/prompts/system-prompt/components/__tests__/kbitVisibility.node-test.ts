import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, test } from "node:test"

/**
 * Two faults from the same session (2026-08-19), both about knowledge the developer could not see.
 *
 * 1. ATTRIBUTION ONLY FOLLOWED `read_file`. `kbit_loaded` was emitted from exactly one place —
 *    ReadFileToolHandler — so workflows and actions earned a credit line and the always-on bits (boards,
 *    protocols, platform rules) loaded in total silence. Those bits shape most of the agent's behaviour,
 *    and the downloaded ones are the bits a developer may be paying for. Omar noticed the card had only
 *    ever shown workflows and actions and asked whether that was deliberate. It was not.
 *
 * 2. NTN KNOWLEDGE FOLLOWED NOTHING. On a task explicitly about satellite, NTN.md never loaded. The agent
 *    invented two modem firmware names that do not exist (`mfw_nrf9161-ntn`, `mfw_nrf91x1-ntn`) and read
 *    "nRF9161 LACA ADA" as the NTN-capable variant — it is an nRF9161, which cannot do NTN at all.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/prompts/system-prompt/components/__tests__/kbitVisibility.node-test.ts
 */

const CTX = path.join(process.cwd(), "src", "core", "prompts", "system-prompt", "components", "iot_context.ts")
const TASK = path.join(process.cwd(), "src", "core", "task", "index.ts")
const STATE = path.join(process.cwd(), "src", "core", "task", "TaskState.ts")

describe("bits injected into the prompt are credited too", () => {
	const ctx = fs.readFileSync(CTX, "utf8")
	const task = fs.readFileSync(TASK, "utf8")

	test("the prompt builder publishes what it injected", () => {
		assert.ok(/export function injectedBitPaths\(\)/.test(ctx), "nothing downstream could see the injected bits")
		assert.ok(/lastInjectedBits = \[\.\.\.loaded\]/.test(ctx), "the tracked-load list must feed it")
	})

	test("the task emits a credit for them", () => {
		assert.ok(/creditInjectedKbits\(\)/.test(task), "must be called from the request path")
		assert.ok(/"kbit_loaded"/.test(task), "must use the same say the read path uses, so the UI groups them")
	})

	test("once per task, not once per request", () => {
		// The system prompt is rebuilt on EVERY API call. Crediting on each build would repeat the same
		// credit line all session long, which reads as a bug and defeats the one-line-per-turn credit law.
		const state = fs.readFileSync(STATE, "utf8")
		assert.ok(/creditedKbits: Set<string>/.test(state), "dedupe must live in task state, not module state")
		assert.ok(/creditedKbits\.has\(id\)/.test(task) && /creditedKbits\.add\(id\)/.test(task))
	})

	test("a bit with no attribution facts stays silent rather than inventing a credit", () => {
		const fn = task.slice(task.indexOf("private async creditInjectedKbits"))
		assert.ok(/if \(!credit\) \{\s*\/\/[\s\S]{0,220}continue/.test(fn), "no manifest entry must mean no credit line")
	})

	test("attribution can never break a request", () => {
		const fn = task.slice(task.indexOf("private async creditInjectedKbits"), task.indexOf("\tasync say("))
		assert.ok(/try \{/.test(fn) && /catch \(e\) \{/.test(fn), "must be fail-open — it is decoration, not function")
	})

	test("the source tier is reported honestly, not assumed", () => {
		assert.ok(/hasBit\(id\)\) \? "bundled" : "registry"/.test(task), "a downloaded bit must not look bundled")
	})
})

describe("NTN knowledge reaches the parts that can do NTN", () => {
	const ctx = fs.readFileSync(CTX, "utf8")

	test("the nRF9151 pulls the NTN bit", () => {
		assert.ok(/nrf9151\/i\.test\(b\.target\)/.test(ctx), "the only nRF91 that can do NTN must load it")
		assert.ok(/protocols\/NTN\.md/.test(ctx), "NTN.md was never injected by anything before this")
	})

	test("a project that asks for NTN pulls it even before hardware is attached", () => {
		assert.ok(/hasNtnIntent/.test(ctx), "CONFIG_NTN in prj.conf is the secondary gate")
		assert.ok(/CONFIG_NTN/.test(ctx))
	})

	test("GNSS rides along, because NTN cannot attach without a position", () => {
		// The modem asks the application for its location (AT%LOCATION) to pre-compensate Doppler and
		// timing for a satellite moving at ~7.5 km/s. No fix, no attach — so the two bits travel together.
		const block = ctx.slice(ctx.indexOf("NTN rides with the nRF9151"))
		assert.ok(/protocols\/GNSS\.md/.test(block.slice(0, 900)))
	})

	test("it does NOT load for every nRF91 — the golden rule is knowledge only where it is needed", () => {
		const block = ctx.slice(ctx.indexOf("const cellularBoard"), ctx.indexOf("if (boardSignals.length > 0)"))
		const ntnAt = block.indexOf("protocols/NTN.md")
		const gateAt = block.indexOf("nrf9151")
		assert.ok(gateAt !== -1 && gateAt < ntnAt, "NTN.md must sit behind the 9151 gate, not beside LTE.md")
	})
})

describe("the bits themselves carry the facts that were got wrong", () => {
	const kb = path.join(process.cwd(), "Adsum-Backend", "kbits", "platforms", "nrf")
	const read = (p: string) => (fs.existsSync(path.join(kb, p)) ? fs.readFileSync(path.join(kb, p), "utf8") : "")

	test("NTN.md forbids inventing a firmware name", () => {
		const s = read("sdks/ncs/protocols/NTN.md")
		assert.ok(s, "NTN bit missing")
		assert.ok(/mfw_nrf9161-ntn/.test(s) && /mfw_nrf91x1-ntn/.test(s), "must name the invented ones to rule them out")
		assert.ok(/only NTN modem firmware that exists/i.test(s))
	})

	test("NTN.md separates LACA ADA from LACA A1A", () => {
		const s = read("sdks/ncs/protocols/NTN.md")
		assert.ok(/LACA ADA/.test(s) && /LACA A1A/.test(s), "the three-character difference that cost thirty messages")
	})

	test("the nRF9161 board bit kills the question at the part number", () => {
		const s = read("boards/nrf9161dk.md")
		assert.ok(/LACA ADA/.test(s), "the DK announces this string at boot; the bit must decode it")
		assert.ok(/CANNOT do it/.test(s))
	})

	test("NTN.md carries the build facts an agent cannot guess", () => {
		const s = read("sdks/ncs/protocols/NTN.md")
		for (const fact of ["CONFIG_NTN", "%SKYLO", "%LOCATION", "23"]) {
			assert.ok(s.includes(fact), `missing ${fact}`)
		}
	})

	test("LTE.md maps the words a log actually prints, not just the numeric code", () => {
		const s = read("sdks/ncs/protocols/LTE.md")
		assert.ok(/UICC fail/.test(s), "the bench log printed this and never printed `90`")
		assert.ok(/MDMEV/.test(s), "the modem's own search commentary explains the long silences")
	})
})

describe("DECT NR+ knowledge reaches a DECT project", () => {
	const ctx = fs.readFileSync(CTX, "utf8")

	test("the bit is loaded at all", () => {
		// It existed, was correct, and NOTHING loaded it. An agent then read `Modem fault: reason=4095`
		// as incapable silicon and told the developer to buy different hardware (2026-08-20).
		assert.ok(/protocols\/DECT-NR\.md/.test(ctx), "DECT-NR.md was injected by nothing")
		assert.ok(/hasDectIntent/.test(ctx))
	})

	test("it does NOT hang off the cellular gate", () => {
		// A DECT project has no SIM and may set no cellular Kconfig at all, so gating it behind
		// `hasCellular` would keep it invisible exactly where it is needed.
		const cellularBlock = ctx.slice(ctx.indexOf("if (hasCellular || cellularBoard)"), ctx.indexOf("hasDectIntent(cwd)"))
		assert.equal(/protocols\/DECT-NR\.md/.test(cellularBlock), false, "DECT must not sit inside the LTE block")
	})

	test("the trigger is a DECT Kconfig, not a generic modem one", () => {
		const fn = ctx.slice(ctx.indexOf("async function hasDectIntent"), ctx.indexOf("async function readKnowledgeFile"))
		assert.ok(/CONFIG_DECT/.test(fn))
		assert.equal(/NRF_MODEM_LIB/.test(fn), false, "every cellular project sets that too — it would misfire")
	})
})

describe("the bits carry today's corrections", () => {
	const kb = path.join(process.cwd(), "Adsum-Backend", "kbits", "platforms", "nrf")
	const read = (p: string) => (fs.existsSync(path.join(kb, p)) ? fs.readFileSync(path.join(kb, p), "utf8") : "")

	test("DECT: the firmware is not a public download, and that is said up front", () => {
		const s = read("sdks/ncs/protocols/DECT-NR.md")
		assert.ok(/sales/i.test(s), "a developer without the binary cannot do DECT at all")
		assert.ok(/4095/.test(s), "the fault code that was misread as wrong silicon")
		assert.ok(/buy different hardware/i.test(s), "must forbid the advice that was actually given")
	})

	test("DECT: an NTN limit must never be generalised to DECT", () => {
		const s = read("sdks/ncs/protocols/DECT-NR.md")
		assert.ok(/NTN is nRF9151-only; DECT NR\+ is not/.test(s))
	})

	test("board-shell: an empty answer is not a finding", () => {
		const s = read("actions/board-shell.md")
		assert.ok(/INCONCLUSIVE/.test(s))
		assert.ok(/COPS=\?/.test(s) && /300/.test(s), "the slow command that was truncated needs its timeout named")
	})

	test("both action bits demand the output be translated for the developer", () => {
		for (const f of ["actions/board-shell.md", "actions/modem-trace.md"]) {
			assert.ok(/ALWAYS TRANSLATE FOR THE DEVELOPER/.test(read(f)), `${f} must carry the translation rule`)
		}
	})

	test("modem-trace: cells-seen must not be reported as no-signal", () => {
		const s = read("actions/modem-trace.md")
		assert.ok(/MasterInformationBlock/.test(s))
		assert.ok(/Never say "no signal"/.test(s))
	})

	test("the LTE bit was split rather than left over length", () => {
		const core = read("sdks/ncs/protocols/LTE.md").split("\n").length
		const ref = read("sdks/ncs/protocols/LTE/at-commands.md").split("\n").length
		assert.ok(core > 0 && ref > 0, "both halves must exist")
		assert.ok(core < 130, `LTE.md is ${core} lines — the corpus rule is small, focused bits`)
		assert.ok(ref < 140, `at-commands.md is ${ref} lines`)
		assert.ok(/LTE\/at-commands\.md/.test(read("sdks/ncs/protocols/LTE.md")), "the core must point at the reference")
	})
})
