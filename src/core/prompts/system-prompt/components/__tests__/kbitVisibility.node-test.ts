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

/**
 * The downloaded bits live in the backend checkout, which sits BESIDE this repository, not inside it.
 *
 * These checks used to read `process.cwd()/Adsum-Backend/kbits` — a folder inside the extension tree that
 * exists on no machine — so every bit-content check failed with "bit missing" and every one was invisible
 * while mocha loaded this file (A8, 14 Sep 2026). The premise was stale, not the bits. Resolve the real
 * sibling (or ADSUM_BACKEND_KBITS), and when it is absent SKIP with the path named: a check that cannot see
 * the bits must neither fail for the wrong reason nor pass on their absence.
 */
const BACKEND_NRF = (() => {
	const root = process.env.ADSUM_BACKEND_KBITS ?? path.resolve(process.cwd(), "..", "Adsum-Backend", "kbits")
	const nrf = path.join(root, "platforms", "nrf")
	return fs.existsSync(nrf) ? nrf : null
})()
const NO_BACKEND = BACKEND_NRF
	? false
	: `the backend corpus is not at ${path.resolve(process.cwd(), "..", "Adsum-Backend", "kbits")} (or ADSUM_BACKEND_KBITS) — these checks read the bits themselves`

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
		// It must come from what the resolver actually served. `hasBit()` is manifest membership, and an
		// overridden bit is BOTH in the manifest and served from the registry — asking the manifest would
		// credit every registry override as shipped-in-the-VSIX, which is the opposite of honest.
		assert.ok(/source: provenanceOf\(id\)/.test(task), "the credit source must be the resolver's provenance")
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
		//
		// [14 Sep 2026] GNSS moved to its own gate on 29 Aug (a GPS mission on an nRF9161 could not reach it
		// while it hung off NTN), so it no longer sits within 900 characters of the NTN comment and this check
		// failed on distance alone. The guarantee is unchanged and is what is asserted now: the GNSS gate
		// still opens for an nRF9151 and for a declared NTN project.
		const gate = ctx.slice(ctx.indexOf("GNSS HANGS OFF ITS OWN GATE"))
		const cond = gate.slice(gate.indexOf("if ("), gate.indexOf("protocols/GNSS.md"))
		assert.ok(cond.length > 0 && /protocols\/GNSS\.md/.test(gate.slice(0, 1500)), "the GNSS gate must exist")
		assert.ok(/nrf9151/i.test(cond), "an nRF9151 must still pull GNSS")
		assert.ok(/hasNtnIntent/.test(cond), "a declared NTN project must still pull GNSS")
	})

	test("it does NOT load for every nRF91 — the golden rule is knowledge only where it is needed", () => {
		const block = ctx.slice(ctx.indexOf("const cellularBoard"), ctx.indexOf("if (boardSignals.length > 0)"))
		const ntnAt = block.indexOf("protocols/NTN.md")
		const gateAt = block.indexOf("nrf9151")
		assert.ok(gateAt !== -1 && gateAt < ntnAt, "NTN.md must sit behind the 9151 gate, not beside LTE.md")
	})
})

describe("the bits themselves carry the facts that were got wrong", { skip: NO_BACKEND }, () => {
	const kb = BACKEND_NRF ?? ""
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

describe("the bits carry today's corrections", { skip: NO_BACKEND }, () => {
	const kb = BACKEND_NRF ?? ""
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

describe("protocol knowledge arrives before the guessing starts", () => {
	const ctx = fs.readFileSync(CTX, "utf8")

	test("a router exists at all", () => {
		// Every other gate reads prj.conf or the attached board. A PROTOTYPE has neither, and the prompt
		// builder cannot see the developer's message — SystemPromptContext carries no user text. So the
		// router is the only thing that can load a protocol bit at message one.
		assert.ok(/Protocol knowledge — load it BEFORE you design or debug/.test(ctx))
	})

	test("all four protocols route, plus both device tools", () => {
		const block = ctx.slice(ctx.indexOf("Protocol knowledge —"), ctx.indexOf("Device tools (shipped"))
		for (const bit of ["LTE.md", "NTN.md", "DECT-NR.md", "GNSS.md", "board-shell.md", "modem-trace.md"]) {
			assert.ok(block.includes(bit), `router does not point at ${bit}`)
		}
	})

	test("the words a developer actually types are the triggers", () => {
		const block = ctx.slice(ctx.indexOf("Protocol knowledge —"), ctx.indexOf("Device tools (shipped"))
		for (const word of ["NB-IoT", "LTE-M", "satellite", "DECT", "GNSS", "AT commands"]) {
			assert.ok(block.includes(word), `"${word}" is not a trigger`)
		}
	})

	test("it says read FIRST, not eventually", () => {
		const block = ctx.slice(ctx.indexOf("Protocol knowledge —"), ctx.indexOf("Device tools (shipped"))
		assert.ok(/FIRST/.test(block))
		assert.ok(/from memory/.test(block), "must forbid answering a capability question from training")
	})

	test("it does not tell the agent to re-read what is already in context", () => {
		const block = ctx.slice(ctx.indexOf("Protocol knowledge —"), ctx.indexOf("Device tools (shipped"))
		assert.ok(/Knowledge Already Loaded/.test(block), "would otherwise double-load every injected bit")
	})
})

describe("the DECT bit refutes what was actually said", { skip: NO_BACKEND }, () => {
	const kb = BACKEND_NRF ?? ""
	const dect = BACKEND_NRF ? fs.readFileSync(path.join(kb, "sdks", "ncs", "protocols", "DECT-NR.md"), "utf8") : ""

	test("the REV3 silicon claim is named and refuted", () => {
		assert.ok(/REV3/.test(dect), "the exact wrong sentence must be quoted to be refuted")
		assert.ok(/nRF91x1/.test(dect), "the reason it is wrong: nRF9161 IS nRF91x1")
	})

	test("'buy different hardware' is forbidden outright", () => {
		assert.ok(/Never say this/.test(dect))
	})

	test("the NTN limit must not be carried across", () => {
		assert.ok(/NTN is nRF9151-only; DECT NR\+ is not/.test(dect))
	})

	test("reason=4095 is decoded", () => {
		// Markdown wraps, so a phrase can straddle a line break. Match against collapsed whitespace rather
		// than reflowing the prose to suit the test.
		const flat = dect.replace(/\s+/g, " ")
		assert.ok(/4095/.test(flat))
		assert.ok(/not\S{0,4} a code defect/i.test(flat), "must say plainly it is not the app's fault")
		assert.ok(/DECT PHY firmware is simply not on the modem core/.test(flat), "and name the real cause")
	})

	test("AT+CGMR is required before calling hardware incapable", () => {
		assert.ok(/AT\+CGMR/.test(dect))
	})
})

describe("the DECT gate matches the sample that is actually used", () => {
	const ctx = fs.readFileSync(CTX, "utf8")
	const fn = ctx.slice(ctx.indexOf("async function hasDectIntent"), ctx.indexOf("async function readKnowledgeFile"))
	// The gate under test, kept in step with the source by the assertion below rather than by hand.
	const GATE = /^\s*CONFIG_\w*DECT\w*\s*=\s*y/im

	test("the test is checking the same pattern the source uses", () => {
		assert.ok(fn.includes(String(GATE)), `iot_context.ts no longer uses ${GATE} — update this test`)
	})

	test("CONFIG_NRF_MODEM_LINK_BINARY_DECT_PHY=y triggers it", () => {
		// dect_phy/hello_dect on NCS 3.3.1 — the sample an agent actually scaffolded on 2026-08-20 —
		// sets NO CONFIG_DECT* symbol at all. A prefix-only gate is dead on the exact project that needs it.
		assert.ok(
			GATE.test(`CONFIG_NRF_MODEM_LIB=y
CONFIG_NRF_MODEM_LINK_BINARY_DECT_PHY=y
`),
		)
	})

	test("the older CONFIG_DECT=y form still triggers it", () => {
		assert.ok(
			GATE.test(`CONFIG_DECT=y
CONFIG_NRF_MODEM_LIB=y
`),
		)
	})

	test("a cellular-only project does NOT trigger it", () => {
		assert.equal(
			GATE.test(`CONFIG_NRF_MODEM_LIB=y
CONFIG_LTE_LINK_CONTROL=y
CONFIG_MQTT_LIB=y
`),
			false,
		)
	})

	test("a disabled DECT symbol does not trigger it", () => {
		assert.equal(
			GATE.test(`CONFIG_DECT_PHY=n
`),
			false,
		)
	})
})

describe("a named bit survives being diverted", () => {
	const ctx = fs.readFileSync(CTX, "utf8")

	test("the router forbids concluding without the protocol bit", () => {
		// The exact 2026-08-20 failure: the agent named DECT-NR.md, said "Let me load that", was diverted
		// to decode-fault.md by the Command Gate, never returned, and spent ~85 messages inventing silicon
		// revisions before telling the developer "nRF9161 REV3 silicon does not support DECT NR+".
		//
		// The prompt is assembled literal by literal, so a sentence is split across seams in the source —
		// both `" + "` concatenations and separate `ctx += "…"` statements. Join them before matching, or
		// the test only ever sees fragments and fails on prose that is actually present.
		const joined = ctx.replace(/"\s*\+\s*"/g, "").replace(/"\s*\n\s*ctx \+= "/g, "")
		assert.ok(/come back to it before you conclude anything/.test(joined))
		assert.ok(/Never state what a part can or cannot do from memory/.test(joined))
	})
})

describe("a refused memory write cannot be shrugged off", () => {
	// Same seam problem as the router: the message is built from concatenated literals.
	const apply = fs
		.readFileSync(path.join(process.cwd(), "src", "core", "memory", "workspace", "writeApply.ts"), "utf8")
		.replace(/"\s*\+\s*"/g, "")

	test("it is stated as a blocker", () => {
		assert.ok(/THIS IS A BLOCKER, NOT A COSMETIC DETAIL/.test(apply))
	})

	test("the workaround the agent actually used is forbidden by name", () => {
		// It bound the whole session to the Desktop and drove the build with absolute paths instead.
		assert.ok(/Do not work around this with absolute paths/.test(apply))
	})

	test("it points at the handover that produces the button", () => {
		assert.ok(/attempt_completion/.test(apply) && /Open project folder/.test(apply))
	})
})

describe("product knowledge is reachable", () => {
	const ctx = fs.readFileSync(CTX, "utf8")
	// There are now TWO router tables — one per platform context. The nRF path always had one; the ESP
	// path gained the product row because the LEW840X is an ESP-hosted product, and an ESP-classified
	// workspace could otherwise never reach the family. Slicing from the FIRST "The developer says" would
	// silently test only whichever table is defined earlier in the file, so collect every block.
	const blocks = [...ctx.matchAll(/The developer says[\s\S]*?Knowledge Already Loaded/g)].map((m) => m[0])

	test("both platform contexts carry a router table", () => {
		assert.equal(blocks.length, 2, `expected an nRF and an ESP router table, found ${blocks.length}`)
	})

	test("the Fanstel gateway routes to its index, from BOTH platform contexts", () => {
		// The bits were authored correct and complete, and NOTHING referenced them — the same way
		// DECT-NR.md sat unreachable for weeks. A bit nobody can reach is indistinguishable from a bit
		// that does not exist. The ESP half is the same failure: the product is an ESP32 application.
		//
		// [14 Sep 2026] Since 4 Sep (I-28) the row is built by `productLine()` rather than written inline in each
		// table, so the path and its trigger words live in that function and each table calls it. The check
		// read the table text for the path and failed on the refactor alone. The guarantee is asserted
		// where it now lives: every table emits productLine(), and productLine() carries the path and triggers.
		const line = ctx.slice(ctx.indexOf("function productLine()"), ctx.indexOf("async function getEspPlatformContext"))
		assert.ok(/products\/fanstel\/lew840x\/PRODUCT\.md/.test(line), "the product row must name the index")
		for (const word of ["Fanstel", "LEW840X", "M.2"]) {
			assert.ok(line.includes(word), `"${word}" is not a trigger`)
		}
		for (const block of blocks) {
			assert.ok(/productLine\(\)/.test(block), "each router table must emit the product row")
		}
	})

	test("the ESP product row is emitted ONCE in a both-platform workspace", () => {
		// A gateway workspace has two CMakeLists and classifies as `both`, so BOTH context builders run.
		// The ESP row is therefore guarded on whether the nRF block already emitted it; without the guard
		// the developer pays for the same table twice and it reads as a corpus bug.
		assert.ok(
			/productRowEmitted/.test(ctx),
			"the ESP router row must be guarded so a both-platform workspace does not print it twice",
		)
		// [14 Sep 2026] The call site's first argument was renamed (`cwd` → `espRoot`) when a workspace could
		// hold the two platforms in different roots; the check matched the old name and failed on the rename.
		// What matters is the third argument.
		assert.ok(
			/getEspPlatformContext\(\w+, load, nrfAlreadyRan\)/.test(ctx),
			"the detect path must pass whether the nRF context already ran",
		)
	})

	test("every router path is written from the knowledge root", () => {
		// The prompt tells the agent to join kbPath with the path it is given. Rows that were relative to
		// platforms/nrf/ produced a path that does not exist when followed literally, and products/ could
		// never be reached from a platform-relative row at all.
		//
		// [14 Sep 2026] The product row is emitted by productLine() (since 4 Sep), so the nRF table's own text
		// carries six paths, not seven; the count failed on the refactor. Count the table's rows plus the
		// product row it emits, and hold every path — including productLine()'s — to the root-relative rule.
		const nrfBlock = blocks.find((b) => b.includes("DECT")) ?? ""
		const line = ctx.slice(ctx.indexOf("function productLine()"), ctx.indexOf("async function getEspPlatformContext"))
		const nrfPaths = [...nrfBlock.matchAll(/`([^`]+\.md)`/g)].map((m) => m[1])
		const emitsProductRow = /productLine\(\)/.test(nrfBlock)
		assert.ok(
			nrfPaths.length + (emitsProductRow ? 1 : 0) >= 7,
			`expected every nRF router row to carry a path, found ${nrfPaths.length}${emitsProductRow ? " + the product row" : ""}`,
		)
		for (const p of [...line.matchAll(/\\`([^`\\]+\.md)\\`|`([^`]+\.md)`/g)].map((m) => m[1] ?? m[2])) {
			if (p.includes("${")) continue // the recognised-product row interpolates its id; its prefix is checked below
			assert.ok(/^(platforms|products|rules|actions|workflows)\//.test(p), `product row path is not root-relative: ${p}`)
		}
		assert.ok(
			/`products\/\$\{found\.id\}\/PRODUCT\.md/.test(line.replace(/\\/g, "")),
			"the recognised-product row is rooted at products/",
		)
		for (const block of blocks) {
			for (const p of [...block.matchAll(/`([^`]+\.md)`/g)].map((m) => m[1])) {
				assert.ok(/^(platforms|products|rules|actions|workflows)\//.test(p), `router path is not root-relative: ${p}`)
			}
		}
	})
})
