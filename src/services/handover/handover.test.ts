/**
 * H1 handover tests. Three layers:
 *   1. the MCP server as a foreign agent actually sees it (spawned process, real JSON-RPC over stdio)
 *   2. the managed CLAUDE.md block (idempotent, never clobbers the developer's own content)
 *   3. the brief builder's pure extraction (a recorded session → mission/worklog/bit ids)
 * Run: npm run test:handover
 */
import { strict as assert } from "node:assert"
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import {
	bridgeLoadVerbs,
	coreFallbackId,
	extractBitRefs,
	extractBriefParts,
	extractRequires,
	managedBlockBody,
	parseWorkflowSteps,
	upsertManagedBlock,
} from "./HandoverBrief"
import { buildHandoverUiState, handoverUiFingerprint } from "./HandoverUiState"

const REPO = path.resolve(__dirname, "..", "..", "..")
const SERVER = path.join(REPO, "mcp", "adsum-mcp.mjs")

// ── a tiny MCP client: exactly what Claude Code does — newline-delimited JSON-RPC over stdio ──
function mcpClient(handoverDir: string) {
	const p = spawn(process.execPath, [SERVER, "--handover-dir", handoverDir], { stdio: ["pipe", "pipe", "pipe"] })
	let buf = ""
	const waiters = new Map<number, (v: any) => void>()
	p.stdout.setEncoding("utf8")
	p.stdout.on("data", (c) => {
		buf += c
		let nl: number
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl).trim()
			buf = buf.slice(nl + 1)
			if (!line) {
				continue
			}
			const msg = JSON.parse(line)
			waiters.get(msg.id)?.(msg)
			waiters.delete(msg.id)
		}
	})
	let seq = 0
	const call = (method: string, params?: any) =>
		new Promise<any>((res, rej) => {
			const id = ++seq
			waiters.set(id, res)
			p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
			setTimeout(() => rej(new Error(`timeout on ${method}`)), 5000)
		})
	const notify = (method: string) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n")
	const raw = (s: string) => p.stdin.write(s + "\n")
	return { call, notify, raw, kill: () => p.kill() }
}

function fixture(): { root: string; id: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-handover-"))
	const id = "t3st"
	fs.mkdirSync(path.join(root, id), { recursive: true })
	fs.writeFileSync(
		path.join(root, id, "brief.json"),
		JSON.stringify({
			mission: "Debug the BLE disconnect under notification load",
			workspace: "/tmp/peripheral_uart",
			env: "nRF52840-DK 960167369 · NCS 3.2.1",
			worklog: ["built firmware", "flashed DK", "captured 30s RTT"],
			nextStep: "reproduce under load and correlate",
			bits: [
				{
					id: "adsum/nrf/workflows/debug-loop",
					title: "BLE debug loop",
					version: "1.2.0",
					author: "Ismail Hamdad",
					attributed: true,
					kind: "knowledge",
					steward: "Adsum Networks",
					triggers: ["debug", "ble"],
					body: "# Debug loop\nstep 1 build",
				},
				{
					id: "adsum/nrf/actions/flash",
					title: "Flash firmware",
					version: "1.1.0",
					author: "Ismail Hamdad",
					attributed: true,
					kind: "knowledge",
					steward: "Adsum Networks",
					triggers: ["flash"],
					body: "# Flash\nwest flash",
				},
			],
		}),
	)
	fs.writeFileSync(path.join(root, id, "state.json"), JSON.stringify({ status: "pending" }))
	return { root, id }
}

describe("MCP server (as a foreign agent sees it)", () => {
	test("handshake, tool list, resume→load→checkpoint, ledger, and resilience", async () => {
		const { root, id } = fixture()
		const c = mcpClient(root)
		try {
			// 1. initialize — must echo the client's protocol version and advertise tools
			const init = await c.call("initialize", {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "test", version: "1" },
			})
			assert.equal(init.result.protocolVersion, "2025-06-18", "echoes client protocol version")
			assert.ok(init.result.capabilities.tools, "advertises tools capability")
			assert.equal(init.result.serverInfo.name, "adsum")
			c.notify("notifications/initialized")

			// 2. tools/list — H1 tools + the H2 t-bit slice, with schemas
			const list = await c.call("tools/list")
			const names = list.result.tools.map((t: any) => t.name).sort()
			assert.deepEqual(names, ["build", "checkpoint", "exec", "inbox", "load_skill", "resume_handover"])
			assert.ok(
				list.result.tools.every((t: any) => t.inputSchema?.type === "object"),
				"every tool has an object schema",
			)

			// 3. resume_handover — brief + credits, and it flips the state to active
			const r = await c.call("tools/call", { name: "resume_handover", arguments: {} })
			const rtext = r.result.content[0].text
			assert.equal(r.result.isError, false)
			assert.match(rtext, /Debug the BLE disconnect/, "mission present")
			assert.match(rtext, /captured 30s RTT/, "worklog present")
			assert.match(
				rtext,
				/◆ BLE debug loop v1\.2\.0 — curated by Ismail Hamdad · steward Adsum Networks/,
				"CREDIT LINE present in the brief",
			)
			assert.equal(JSON.parse(fs.readFileSync(path.join(root, id, "state.json"), "utf8")).status, "active")

			// 4. load_skill — exact id, keyword, and an honest miss
			const exact = await c.call("tools/call", { name: "load_skill", arguments: { query: "adsum/nrf/actions/flash" } })
			assert.match(
				exact.result.content[0].text,
				/^◆ Flash firmware v1\.1\.0 — curated by Ismail Hamdad/,
				"credit line leads the body",
			)
			assert.match(exact.result.content[0].text, /west flash/, "body served")
			const kw = await c.call("tools/call", { name: "load_skill", arguments: { query: "debug" } })
			assert.match(kw.result.content[0].text, /Debug loop/, "keyword match works")
			const miss = await c.call("tools/call", { name: "load_skill", arguments: { query: "nonexistent-xyz" } })
			assert.equal(miss.result.isError, true)
			assert.match(miss.result.content[0].text, /adsum\/nrf\/workflows\/debug-loop/, "miss lists what IS available")

			// 5. checkpoint — state + ledger (schema-light call still works; the enum is advisory server-side)
			const ck = await c.call("tools/call", {
				name: "checkpoint",
				arguments: { worklog: "repro'd 0x08 at 87s", step: "off-plan", tools_used: ["editor_tools"] },
			})
			assert.match(ck.result.content[0].text, /✓ Recorded to Adsum session/)
			assert.equal(
				JSON.parse(fs.readFileSync(path.join(root, id, "state.json"), "utf8")).lastCheckpoint,
				"repro'd 0x08 at 87s",
			)

			// 6. the ledger is the honest record the extension tails
			const events = fs
				.readFileSync(path.join(root, id, "ledger.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))
			assert.deepEqual(
				events.map((e) => e.event),
				["resume", "kbit_load", "kbit_load", "checkpoint"],
			)
			assert.equal(events[1].author, "Ismail Hamdad", "attribution is recorded, not just displayed")

			// 7. resilience: a malformed line must not kill the server, and unknown methods are proper errors
			c.raw("{not json at all")
			const stillAlive = await c.call("ping")
			assert.ok(stillAlive.result, "server survives malformed input")
			const unknown = await c.call("no/such/method")
			assert.equal(unknown.error.code, -32601)
		} finally {
			c.kill()
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("inbox: lists pending handovers with pickup instructions; empty inbox says so", async () => {
		const { root, id } = fixture()
		const c = mcpClient(root)
		try {
			await c.call("initialize", { protocolVersion: "2025-06-18" })
			const list = await c.call("tools/list")
			assert.deepEqual(list.result.tools.map((t: any) => t.name).sort(), [
				"build",
				"checkpoint",
				"exec",
				"inbox",
				"load_skill",
				"resume_handover",
			])
			// pending handover shows up as actionable work
			const inbox = await c.call("tools/call", { name: "inbox", arguments: {} })
			const text = inbox.result.content[0].text
			assert.match(text, /1 pending handover/)
			assert.match(text, new RegExp(id), "lists the handover id")
			assert.match(text, /Debug the BLE disconnect/, "shows the mission")
			assert.match(text, /resume_handover/, "tells the agent how to pick it up")
			// after resuming, the inbox is empty (status flipped to active) but still shows recent state
			await c.call("tools/call", { name: "resume_handover", arguments: {} })
			const after = await c.call("tools/call", { name: "inbox", arguments: {} })
			assert.match(after.result.content[0].text, /empty — no pending handovers/)
			assert.match(after.result.content[0].text, /active/, "recent sessions still visible")
		} finally {
			c.kill()
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("no handover on disk → actionable error, never a crash", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-empty-"))
		const c = mcpClient(root)
		try {
			await c.call("initialize", { protocolVersion: "2025-06-18" })
			const r = await c.call("tools/call", { name: "resume_handover", arguments: {} })
			assert.equal(r.result.isError, true)
			assert.match(r.result.content[0].text, /Hand session to my coding agent/, "tells the developer what to do")
		} finally {
			c.kill()
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("managed CLAUDE.md block", () => {
	const BLOCK = "## Adsum embedded workflow\n- call adsum.resume_handover first"
	test("creates, preserves user content, is idempotent, and backs off on user edits", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-md-"))
		const md = path.join(dir, "CLAUDE.md")
		try {
			// fresh file
			assert.equal(upsertManagedBlock(md, BLOCK), "created")
			assert.match(fs.readFileSync(md, "utf8"), /adsum:managed:begin/)

			// user content above is preserved
			fs.writeFileSync(md, "# My project rules\nAlways use tabs.\n\n" + fs.readFileSync(md, "utf8"))
			assert.equal(upsertManagedBlock(md, BLOCK + "\n- updated rule"), "updated")
			const after = fs.readFileSync(md, "utf8")
			assert.match(after, /Always use tabs\./, "user content survives")
			assert.match(after, /- updated rule/, "block content refreshed")
			assert.equal(after.match(/adsum:managed:begin/g)?.length, 1, "exactly one managed block")

			// idempotent: same content twice = no change
			const before = fs.readFileSync(md, "utf8")
			assert.equal(upsertManagedBlock(md, BLOCK + "\n- updated rule"), "unchanged")
			assert.equal(fs.readFileSync(md, "utf8"), before)

			// a developer edit INSIDE the block → back off rather than clobber
			fs.writeFileSync(md, fs.readFileSync(md, "utf8").replace("- updated rule", "- I EDITED THIS BY HAND"))
			assert.equal(upsertManagedBlock(md, BLOCK + "\n- newer rule"), "skipped-user-edited")
			assert.match(fs.readFileSync(md, "utf8"), /I EDITED THIS BY HAND/, "developer's edit is untouched")
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("brief extraction from a recorded session", () => {
	test("pulls mission, worklog, and the k-bit paths the session actually used", () => {
		const ui = [
			{ type: "say", say: "text", text: "Debug peripheral_uart — find why it disconnects." },
			{ say: "api_req_started", text: "{}" },
			{ say: "text", type: "say", text: "Let me check what's connected." },
			{ say: "task_progress", text: "- [x] enumerate devices\n- [x] build firmware\n- [ ] capture logs" },
			{ say: "text", type: "say", text: "Build passed; firmware is flashed." },
		]
		const meta = {
			files_in_context: [
				{ path: "src/main.c" },
				{ path: "~/x/Adsum-IoT-Coder-Review/iot-knowledge/platforms/nrf/workflows/debug-loop.md" },
				{ path: "~/x/Adsum-IoT-Coder-Review/iot-knowledge/platforms/nrf/actions/flash.md" },
			],
		}
		const b = extractBriefParts(ui, meta)
		assert.equal(b.mission, "Debug peripheral_uart — find why it disconnects.")
		// Re-handover of a returned session: the opening prompt is OUR boilerplate, not the mission —
		// ingesting it verbatim degrades the mission one generation per round trip (seen live on the strip).
		const rehandover = extractBriefParts(
			[
				{
					type: "say",
					say: "text",
					text: "Continue this task — it was handed to my coding agent and I'm bringing it back.\n\nOriginal mission: Test and validate softAP — host tests now.\nDone before handover:\n- built firmware",
				},
			],
			{},
		)
		assert.equal(rehandover.mission, "Test and validate softAP — host tests now.", "recovers the real mission")
		assert.deepEqual(b.worklog, ["enumerate devices", "build firmware"], "only COMPLETED items are 'done so far'")
		assert.equal(b.nextStep, "capture logs", "the first unchecked item is the next step")
		assert.equal(b.lastSummary, "Build passed; firmware is flashed.")
		assert.deepEqual(b.kbitRelPaths, ["platforms/nrf/workflows/debug-loop.md", "platforms/nrf/actions/flash.md"])
	})
})

describe("dependency closure + verb bridge (H2.0 — the live-test gap)", () => {
	// The real add-feature idiom: prose "MANDATORY SKILL LOAD: read_file → platforms/...", plus a
	// platform-relative "actions/x.md" shorthand — NO requires: frontmatter.
	const addFeatureBody = [
		"# Add Feature Workflow (workflows/add-feature.md)",
		"See prototype.md for the scaffolding pattern.",
		"**MANDATORY SKILL LOAD:** `read_file` → `platforms/esp/actions/find-sample.md` and follow it.",
		"4. **Kconfig** → only if the feature needs it (`actions/configure.md` for the sdkconfig).",
		"read loop via `find-sample.md` — never invent register sequences.",
		"- **MANDATORY SKILL LOAD:** if it needs debugging, `read_file` → `platforms/esp/workflows/debug-loop.md`.",
	].join("\n")

	test("extractBitRefs: pulls full-path AND platform-relative spokes, drops self + bare filenames", () => {
		const refs = extractBitRefs("adsum/esp/workflows/add-feature", addFeatureBody)
		assert.ok(refs.includes("adsum/esp/actions/find-sample"), "full path platforms/esp/actions/find-sample.md")
		assert.ok(refs.includes("adsum/esp/workflows/debug-loop"), "full path platforms/esp/workflows/debug-loop.md")
		assert.ok(refs.includes("adsum/esp/actions/configure"), "relative actions/configure.md → same platform")
		assert.ok(!refs.includes("adsum/esp/workflows/add-feature"), "a bit does not depend on itself")
		// bare 'prototype.md' / 'find-sample.md' are ambiguous back-references → not resolved as new deps
		assert.ok(!refs.some((r) => r.endsWith("/prototype")), "bare filename not guessed")
	})

	test("bridgeLoadVerbs: rewrites the read_file→path idiom to load_skill, leaves other prose alone", () => {
		const out = bridgeLoadVerbs("adsum/esp/workflows/add-feature", addFeatureBody)
		assert.ok(out.includes('call `load_skill("adsum/esp/actions/find-sample")`'), "full path bridged")
		assert.ok(out.includes('call `load_skill("adsum/esp/workflows/debug-loop")`'), "second directive bridged")
		assert.ok(!out.includes("read_file` → `platforms"), "no read_file→path directive survives")
		assert.ok(out.includes("never invent register sequences"), "ordinary prose untouched")
		assert.ok(out.includes("See prototype.md"), "non-directive filename mention untouched")
	})

	test("extractBitRefs: nRF platform relative refs resolve to nRF, not the source's platform by accident", () => {
		const refs = extractBitRefs(
			"adsum/nrf/workflows/demo-debug",
			"load `actions/flash.md` then `platforms/nrf/actions/capture-logs.md`",
		)
		assert.ok(refs.includes("adsum/nrf/actions/flash"))
		assert.ok(refs.includes("adsum/nrf/actions/capture-logs"))
	})
})

describe("H2.0.1 — requires: frontmatter, workflow steps, core fallback (the softAP defects)", () => {
	test("extractRequires: YAML list form (the real test-validate declaration) and inline form", () => {
		const yaml = [
			"id: adsum/esp/workflows/test-validate",
			"version: 1.2.0",
			"requires:",
			"  - adsum/esp/actions/run-tests",
			"  - adsum/esp/actions/setup-ci",
			"  - adsum/esp/workflows/debug-loop",
			"platform: esp",
		].join("\n")
		assert.deepEqual(extractRequires(yaml), [
			"adsum/esp/actions/run-tests",
			"adsum/esp/actions/setup-ci",
			"adsum/esp/workflows/debug-loop",
		])
		assert.deepEqual(extractRequires('requires: ["adsum/a/b", adsum/c/d]'), ["adsum/a/b", "adsum/c/d"])
		assert.deepEqual(extractRequires("id: x\nplatform: esp"), [], "no requires → empty, never a crash")
	})

	test("parseWorkflowSteps: ordered labels from real heading forms (Step N: … and STEP 0 — …)", () => {
		const body = [
			"# Test & Validate Workflow",
			"## Step 1: Confirm scope gate",
			"prose",
			"## Step 2: Survey what's actually runnable (BEFORE offering anything)",
			"## STEP 0 — Environment, then tier (do this FIRST, before any command)",
			"### not a step heading",
			"## Step 7: Offer the durable setup — CI on GitHub",
		].join("\n")
		const steps = parseWorkflowSteps(body)
		assert.equal(steps[0], "Step 1: Confirm scope gate")
		assert.match(steps[1], /^Step 2: Survey what's actually runnable/)
		assert.match(steps[2], /^Step 0: Environment, then tier/)
		assert.match(steps[3], /^Step 7: Offer the durable setup — CI on GitHub/)
		assert.equal(steps.length, 4)
	})

	test("coreFallbackId: platform-scoped rules fall back to the core corpus; actions do not", () => {
		assert.equal(coreFallbackId("adsum/esp/rules/next-step"), "adsum/rules/next-step")
		assert.equal(coreFallbackId("adsum/nrf/references/x"), "adsum/references/x")
		assert.equal(coreFallbackId("adsum/esp/actions/build"), null, "actions are platform-owned — no fallback")
	})

	test("managed block: instructs the glyph the server actually emits, mutation checkpoints, closing checkpoint", () => {
		const body = managedBlockBody("ab12")
		assert.match(body, /◆ <bit> — curated by <author>/, "glyph matches the server (the 📚 drift defect)")
		assert.ok(!body.includes("📚"), "the never-emitted glyph is gone")
		assert.match(body, /after any file mutation/i, "mutation-checkpoint rule present")
		assert.match(body, /final: true/, "closing checkpoint rule present")
		assert.match(body, /adsum\.exec/, "steers embedded commands to the env-carrying tool")
	})
})

// ── H2.1 v1 + t-bits: the interrogation dialogue and the environment tools ──
function richFixture(): { root: string; id: string; ws: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-h2-"))
	const ws = path.join(root, "ws")
	fs.mkdirSync(ws, { recursive: true })
	// a fake activation script the exec tool sources — proves env-carrying without a real IDF
	const activate = path.join(root, "activate_idf_v9.9.9.sh")
	fs.writeFileSync(activate, "export ADSUM_TEST_ENV=sourced\n")
	// an index-only bit on disk (bundled-tree stand-in) with frontmatter + the read_file idiom
	const extraBit = path.join(root, "esp-terminal.md")
	fs.writeFileSync(
		extraBit,
		"---\nid: adsum/esp/rules/esp-terminal\nauthor: Omar Morceli\n---\n# Rule\nsee `read_file` → `platforms/esp/actions/build.md` for builds\n",
	)
	const id = "h2t1"
	fs.mkdirSync(path.join(root, id), { recursive: true })
	fs.writeFileSync(
		path.join(root, id, "brief.json"),
		JSON.stringify({
			mission: "Test and validate softAP",
			workspace: ws,
			governing: "adsum/esp/workflows/test-validate",
			steps: ["Step 1: Confirm scope gate", "Step 2: Survey what's actually runnable", "Step 4: Run the Unity suite"],
			baseline: { ref: "0123456789abcdef", managed: true },
			idf: { activate },
			bits: [
				{
					id: "adsum/esp/workflows/test-validate",
					title: "Test & Validate Workflow",
					version: "1.2.0",
					author: "Omar Morceli",
					attributed: true,
					kind: "knowledge",
					steward: "Adsum Networks",
					hop: 0,
					body: "# TV\nsteps here",
				},
				{
					id: "adsum/esp/actions/run-tests",
					title: "Action: Run Tests",
					version: "1.2.0",
					author: "Omar Morceli",
					attributed: true,
					kind: "knowledge",
					steward: "Adsum Networks",
					hop: 1,
					via: "adsum/esp/workflows/test-validate",
					body: "# RT",
				},
			],
			unresolved: [{ id: "adsum/esp/rules/next-step", via: "adsum/esp/workflows/debug-loop" }],
			index: [
				{
					id: "adsum/esp/rules/esp-terminal",
					title: "ESP Terminal Rule",
					author: "Omar Morceli",
					kind: "knowledge",
					path: extraBit,
				},
			],
		}),
	)
	fs.writeFileSync(path.join(root, id, "state.json"), JSON.stringify({ status: "pending" }))
	return { root, id, ws }
}

describe("H2.1 v1 — the milestone dialogue (interrogating responses, zero inference)", () => {
	test("resume: ★ governing with step checklist, ◆ closure with via, ⚠ unresolved, ≡ index", async () => {
		const { root } = richFixture()
		const c = mcpClient(root)
		try {
			await c.call("initialize", { protocolVersion: "2025-06-18" })
			// the checkpoint schema's step enum comes from the brief — the agent classifies, we state-machine
			const list = await c.call("tools/list")
			const ck = list.result.tools.find((t: any) => t.name === "checkpoint")
			assert.deepEqual(ck.inputSchema.properties.step.enum, [
				"Step 1: Confirm scope gate",
				"Step 2: Survey what's actually runnable",
				"Step 4: Run the Unity suite",
				"off-plan",
			])
			assert.deepEqual(ck.inputSchema.required, ["worklog", "step", "tools_used"])
			const r = await c.call("tools/call", { name: "resume_handover", arguments: {} })
			const text = r.result.content[0].text
			assert.match(text, /★ Governing workflow/, "governing marked, not buried")
			assert.match(text, /- \[ \] Step 1: Confirm scope gate/, "steps rendered as a checklist")
			assert.match(text, /◆ Its knowledge closure/, "closure grouped under the governing bit")
			assert.match(text, /\(via test-validate\)/, "hop provenance visible")
			assert.match(text, /⚠ Referenced but not bundled/, "unresolved deps listed honestly")
			assert.match(text, /adsum\/esp\/rules\/next-step/, "the dangling ref is named")
			assert.match(text, /≡ Also available/, "manifest index = full field of view")
			assert.match(text, /Git baseline/, "baseline surfaced")
		} finally {
			c.kill()
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("checkpoint dialogue: step position + next step, own-terminal nudge, mutation→build nudge, closing", async () => {
		const { root, id } = richFixture()
		const c = mcpClient(root)
		try {
			await c.call("initialize", { protocolVersion: "2025-06-18" })
			await c.call("tools/call", { name: "resume_handover", arguments: {} })
			// in-plan step → response names THE NEXT step (the interrogation, from parsed steps alone)
			const a = await c.call("tools/call", {
				name: "checkpoint",
				arguments: { worklog: "scope gate confirmed", step: "Step 1: Confirm scope gate", tools_used: ["editor_tools"] },
			})
			assert.match(a.result.content[0].text, /completed \*\*Step 1: Confirm scope gate\*\*/)
			assert.match(a.result.content[0].text, /Next is \*\*Step 2: Survey what's actually runnable\*\*/)
			assert.match(a.result.content[0].text, /Report back at the next milestone/)
			// own_terminal → drift question; files_touched → build nudge
			const b = await c.call("tools/call", {
				name: "checkpoint",
				arguments: {
					worklog: "extracted sta_table.h",
					step: "Step 2: Survey what's actually runnable",
					tools_used: ["own_terminal"],
					files_touched: ["main/sta_table.h", "main/softap_example_main.c"],
				},
			})
			const bt = b.result.content[0].text
			assert.match(bt, /own terminal/, "own-terminal use is questioned")
			assert.match(bt, /`exec`\/`build`/, "steered to the env-carrying tools")
			assert.match(bt, /Run `build` before claiming this step done/, "mutation → build gate nudge")
			// closing checkpoint flips the state and stops interrogating
			const fin = await c.call("tools/call", {
				name: "checkpoint",
				arguments: {
					worklog: "suite scaffolded and green",
					step: "Step 4: Run the Unity suite",
					tools_used: ["adsum.build"],
					files_touched: ["test/main/test_sta.c"],
					final: true,
					next_step: "run on hardware when a board is connected",
				},
			})
			assert.match(fin.result.content[0].text, /Closing checkpoint accepted/)
			assert.equal(JSON.parse(fs.readFileSync(path.join(root, id, "state.json"), "utf8")).status, "closed-by-agent")
			// the ledger carries the structured answers — the H2.2 instrument reads these
			const events = fs
				.readFileSync(path.join(root, id, "ledger.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))
			const cps = events.filter((e) => e.event === "checkpoint")
			assert.deepEqual(cps[1].tools_used, ["own_terminal"])
			assert.deepEqual(cps[2].files_touched, ["test/main/test_sta.c"])
			assert.equal(cps[2].final, true)
		} finally {
			c.kill()
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("load_skill: serves an index (non-closure) bit from disk, bridged, with credit + reminder footer", async () => {
		const { root } = richFixture()
		const c = mcpClient(root)
		try {
			await c.call("initialize", { protocolVersion: "2025-06-18" })
			await c.call("tools/call", { name: "resume_handover", arguments: {} })
			const r = await c.call("tools/call", { name: "load_skill", arguments: { query: "adsum/esp/rules/esp-terminal" } })
			const text = r.result.content[0].text
			assert.equal(r.result.isError, false)
			assert.match(text, /^◆ ESP Terminal Rule — curated by Omar Morceli/, "credit from index metadata")
			assert.ok(!text.includes("id: adsum/esp"), "frontmatter stripped")
			assert.match(text, /load_skill\("adsum\/esp\/actions\/build"\)/, "read_file idiom bridged on demand")
			assert.match(text, /Report back with `checkpoint`/, "reminder footer rides every serve")
		} finally {
			c.kill()
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("t-bit slice — exec/build carry the environment; installs are refused", () => {
	test("exec: sources the activation script, runs in the workspace, logs to the ledger", async () => {
		const { root, id, ws } = richFixture()
		const c = mcpClient(root)
		try {
			await c.call("initialize", { protocolVersion: "2025-06-18" })
			await c.call("tools/call", { name: "resume_handover", arguments: {} })
			const r = await c.call("tools/call", { name: "exec", arguments: { command: "echo env=$ADSUM_TEST_ENV in $(pwd)" } })
			const text = r.result.content[0].text
			assert.equal(r.result.isError, false)
			assert.match(text, /env=sourced/, "the activation script WAS sourced — the whole point of the tool")
			assert.ok(text.includes(path.basename(ws)), "runs in the handover workspace by default")
			assert.match(text, /exit 0/)
			const events = fs
				.readFileSync(path.join(root, id, "ledger.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))
			assert.ok(
				events.some((e) => e.event === "tool_exec" && e.exit === 0),
				"exec lands in the ledger",
			)
		} finally {
			c.kill()
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("exec: refuses toolchain installs (the softAP install.sh improvisation, made impossible)", async () => {
		const { root } = richFixture()
		const c = mcpClient(root)
		try {
			await c.call("initialize", { protocolVersion: "2025-06-18" })
			await c.call("tools/call", { name: "resume_handover", arguments: {} })
			const r = await c.call("tools/call", { name: "exec", arguments: { command: "./install.sh linux" } })
			assert.equal(r.result.isError, true)
			assert.match(r.result.content[0].text, /installs or mutates a toolchain/)
			assert.match(r.result.content[0].text, /ask them/, "the refusal is actionable: report + ask the developer")
		} finally {
			c.kill()
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("exec with no locatable environment: honest refusal, never improvised sourcing", async () => {
		const { root, id } = richFixture()
		// break the activation script path
		const briefPath = path.join(root, id, "brief.json")
		const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"))
		brief.idf = { activate: path.join(root, "does-not-exist.sh") }
		fs.writeFileSync(briefPath, JSON.stringify(brief))
		const c = mcpClient(root)
		try {
			await c.call("initialize", { protocolVersion: "2025-06-18" })
			await c.call("tools/call", { name: "resume_handover", arguments: {} })
			const r = await c.call("tools/call", { name: "exec", arguments: { command: "idf.py --version" } })
			assert.equal(r.result.isError, true)
			assert.match(r.result.content[0].text, /could not be located/)
			assert.match(r.result.content[0].text, /ask the developer/)
		} finally {
			c.kill()
			fs.rmSync(root, { recursive: true, force: true })
		}
	})
})

// ── the webview's view of a handover (WP-1: the pure builder) ──────────────
function uiFixture(opts: { status?: string; ledger?: any[]; observations?: any[]; brief?: any; createdAt?: string }): {
	root: string
	id: string
} {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-ui-"))
	const id = "ui01"
	fs.mkdirSync(path.join(root, id), { recursive: true })
	const createdAt = opts.createdAt ?? new Date().toISOString()
	fs.writeFileSync(
		path.join(root, id, "brief.json"),
		JSON.stringify({
			mission: "Test and validate softAP",
			workspace: "/tmp/softAP",
			governing: "adsum/esp/workflows/test-validate",
			baseline: { ref: "0123456789abcdef", managed: true },
			bits: [
				{
					id: "adsum/esp/workflows/test-validate",
					title: "Test & Validate Workflow",
					version: "1.2.0",
					author: "Omar Morceli",
					attributed: true,
					steward: "Adsum Networks",
				},
				{ id: "adsum/esp/actions/run-tests", title: "Action: Run Tests", author: "Omar Morceli", attributed: true },
			],
			...opts.brief,
		}),
	)
	fs.writeFileSync(path.join(root, id, "state.json"), JSON.stringify({ status: opts.status ?? "pending", createdAt }))
	if (opts.ledger) {
		fs.writeFileSync(path.join(root, id, "ledger.jsonl"), opts.ledger.map((e) => JSON.stringify(e)).join("\n") + "\n")
	}
	if (opts.observations) {
		fs.writeFileSync(
			path.join(root, id, "observations.jsonl"),
			opts.observations.map((e) => JSON.stringify(e)).join("\n") + "\n",
		)
	}
	return { root, id }
}
const CONDUCTOR = { active: true, reason: "no inference provider configured" }
const T = (n: number) => new Date(Date.UTC(2026, 6, 18, 19, n)).toISOString()

describe("HandoverUiState — the strip's contract (pure builder)", () => {
	test("phase mapping: posted → pickedUp → working → closed; returned/stale render nothing", () => {
		const posted = uiFixture({ status: "pending" })
		assert.equal(buildHandoverUiState(posted.root, CONDUCTOR).strip?.phase, "posted")
		fs.rmSync(posted.root, { recursive: true, force: true })

		// resumed but no work yet — the agent has the brief and is reading
		const picked = uiFixture({ status: "active", ledger: [{ t: T(0), event: "resume", bits: 14 }] })
		assert.equal(buildHandoverUiState(picked.root, CONDUCTOR).strip?.phase, "pickedUp")
		fs.rmSync(picked.root, { recursive: true, force: true })

		const working = uiFixture({
			status: "active",
			ledger: [
				{ t: T(0), event: "resume" },
				{ t: T(1), event: "checkpoint", worklog: "survey done", step: "Step 2: Survey" },
			],
		})
		assert.equal(buildHandoverUiState(working.root, CONDUCTOR).strip?.phase, "working")
		fs.rmSync(working.root, { recursive: true, force: true })

		const closed = uiFixture({
			status: "closed-by-agent",
			ledger: [{ t: T(5), event: "checkpoint", worklog: "suite green", final: true }],
		})
		assert.equal(buildHandoverUiState(closed.root, CONDUCTOR).strip?.phase, "closed")
		fs.rmSync(closed.root, { recursive: true, force: true })

		// the developer pulled it back — nothing to show
		const returned = uiFixture({ status: "returned" })
		assert.equal(buildHandoverUiState(returned.root, CONDUCTOR).strip, null, "returned → no strip")
		fs.rmSync(returned.root, { recursive: true, force: true })

		// a handover from last week must not haunt the panel
		const stale = uiFixture({ status: "active", createdAt: new Date(Date.now() - 72 * 3600_000).toISOString() })
		assert.equal(buildHandoverUiState(stale.root, CONDUCTOR).strip, null, "stale → no strip")
		fs.rmSync(stale.root, { recursive: true, force: true })
	})

	test("milestones: all six row kinds, time-ordered, two witnesses kept distinct", () => {
		const { root } = uiFixture({
			status: "active",
			ledger: [
				{ t: T(0), event: "resume" },
				{
					t: T(1),
					event: "kbit_load",
					id: "adsum/esp/workflows/test-validate",
					title: "Test & Validate Workflow",
					version: "1.2.0",
					author: "Omar Morceli",
				},
				{ t: T(2), event: "checkpoint", worklog: "survey done", step: "Step 2: Survey", tools_used: ["editor_tools"] },
				{ t: T(3), event: "tool_exec", command: "idf.py --version", exit: 0 },
			],
			observations: [
				{ t: T(4), event: "tree_change", files: ["main/sta_table.h"] },
				{ t: T(5), event: "snapshot" },
			],
		})
		const rows = buildHandoverUiState(root, CONDUCTOR).strip!.milestones
		assert.deepEqual(
			rows.map((r) => r.kind),
			["bit", "step", "tool", "host", "snap"],
			"agent-reported and host-observed rows interleave by time but keep their own kinds",
		)
		const bit = rows[0] as any
		assert.equal(bit.author, "Omar Morceli", "the author's credit travels into the strip")
		assert.equal((rows[1] as any).step, "Step 2: Survey")
		assert.deepEqual((rows[3] as any).files, ["main/sta_table.h"])
		fs.rmSync(root, { recursive: true, force: true })
	})

	test("nudges are DERIVED: own-terminal use, and source edited without a build", () => {
		const { root } = uiFixture({
			status: "active",
			ledger: [
				{ t: T(1), event: "checkpoint", worklog: "probed the env", step: "Step 1", tools_used: ["own_terminal"] },
				{
					t: T(2),
					event: "checkpoint",
					worklog: "extracted sta_table.h",
					tools_used: ["editor_tools"],
					files_touched: ["main/sta_table.h"],
				},
				{ t: T(4), event: "checkpoint", worklog: "next thing", tools_used: ["editor_tools"] },
			],
		})
		const nudges = buildHandoverUiState(root, CONDUCTOR).strip!.milestones.filter((r) => r.kind === "nudge") as any[]
		assert.equal(nudges.length, 2)
		assert.match(nudges[0].text, /its own terminal/)
		assert.match(nudges[1].text, /without building/)
		fs.rmSync(root, { recursive: true, force: true })
	})

	test("the closing checkpoint is never nudged — its file list is cumulative, and it is too late to act", () => {
		const { root } = uiFixture({
			status: "closed-by-agent",
			ledger: [
				{ t: T(2), event: "checkpoint", worklog: "edited", tools_used: ["editor_tools"], files_touched: ["main/x.c"] },
				{ t: T(3), event: "tool_build", command: "idf.py build", exit: 0 },
				{
					t: T(4),
					event: "checkpoint",
					worklog: "done",
					final: true,
					tools_used: ["adsum.build"],
					files_touched: ["main/x.c", "test/t.c"],
				},
			],
		})
		const nudges = buildHandoverUiState(root, CONDUCTOR).strip!.milestones.filter((r) => r.kind === "nudge")
		assert.equal(nudges.length, 0, "it built mid-session, and the closing summary must not re-fire the gate")
		fs.rmSync(root, { recursive: true, force: true })
	})

	test("a build between checkpoints clears the edit-without-build nudge", () => {
		const { root } = uiFixture({
			status: "active",
			ledger: [
				{ t: T(2), event: "checkpoint", worklog: "edited", tools_used: ["adsum.build"], files_touched: ["main/x.c"] },
				{ t: T(3), event: "tool_build", command: "idf.py build", exit: 0 },
				{ t: T(4), event: "checkpoint", worklog: "next", tools_used: ["editor_tools"] },
			],
		})
		const nudges = buildHandoverUiState(root, CONDUCTOR).strip!.milestones.filter((r) => r.kind === "nudge")
		assert.equal(nudges.length, 0, "it did build — no nudge")
		fs.rmSync(root, { recursive: true, force: true })
	})

	test("closing receipt: what it says vs what Adsum measured, never conflated", () => {
		const { root } = uiFixture({
			status: "closed-by-agent",
			ledger: [
				{
					t: T(1),
					event: "kbit_load",
					id: "adsum/esp/workflows/test-validate",
					title: "Test & Validate",
					author: "Omar Morceli",
				},
				{ t: T(2), event: "tool_build", command: "idf.py build", exit: 0 },
				{
					t: T(3),
					event: "checkpoint",
					worklog: "Suite scaffolded and green — 6 cases",
					final: true,
					files_touched: ["test/main/test_sta.c"],
					next_step: "run on hardware when a board is connected",
				},
			],
			observations: [
				{ t: T(2), event: "snapshot" },
				{ t: T(4), event: "diffstat", text: "3 files changed, 214 insertions(+), 9 deletions(-)" },
			],
		})
		const c = buildHandoverUiState(root, CONDUCTOR).strip!.closing!
		assert.match(c.headline, /Suite scaffolded and green/)
		assert.deepEqual(c.itSays.files, ["test/main/test_sta.c"], "what the AGENT reported")
		assert.match(c.itSays.nextStep!, /on hardware/)
		assert.match(c.adsumSaw.diffstat!, /3 files changed/, "what ADSUM measured — host-written only")
		assert.equal(c.adsumSaw.snapshots, 1)
		assert.equal(c.adsumSaw.buildsGreen, true)
		assert.deepEqual(c.standingOn.authors, ["Omar Morceli"])
		assert.equal(c.standingOn.steward, "Adsum Networks")
		fs.rmSync(root, { recursive: true, force: true })
	})

	test("a claimed-but-unobserved change never becomes 'Adsum saw'", () => {
		const { root } = uiFixture({
			status: "closed-by-agent",
			ledger: [{ t: T(3), event: "checkpoint", worklog: "did loads", final: true, files_touched: ["a.c", "b.c"] }],
			// no observations at all — the host saw nothing
		})
		const c = buildHandoverUiState(root, CONDUCTOR).strip!.closing!
		assert.deepEqual(c.itSays.files, ["a.c", "b.c"])
		assert.equal(c.adsumSaw.diffstat, undefined, "no diffstat observed → the receipt must not invent one")
		assert.equal(c.adsumSaw.snapshots, 0)
		assert.equal(c.adsumSaw.buildsGreen, false, "no build ran → not green")
		fs.rmSync(root, { recursive: true, force: true })
	})

	test("live pulse only while genuinely recent; truncation flags the overflow", () => {
		const now = Date.parse(T(10))
		const fresh = uiFixture({
			status: "active",
			ledger: [{ t: T(10), event: "tool_build", command: "idf.py build", exit: 0 }],
		})
		const live = buildHandoverUiState(fresh.root, CONDUCTOR, now).strip!.live
		assert.equal(live?.verb, "building…", "the verb names what is actually happening")
		fs.rmSync(fresh.root, { recursive: true, force: true })

		const quiet = uiFixture({ status: "active", ledger: [{ t: T(0), event: "checkpoint", worklog: "x" }] })
		assert.equal(buildHandoverUiState(quiet.root, CONDUCTOR, now).strip!.live, undefined, "10 min quiet → no false 'live'")
		fs.rmSync(quiet.root, { recursive: true, force: true })

		const many = uiFixture({
			status: "active",
			ledger: Array.from({ length: 40 }, (_, i) => ({ t: T(i), event: "checkpoint", worklog: `step ${i}` })),
		})
		const s = buildHandoverUiState(many.root, CONDUCTOR, now).strip!
		assert.equal(s.milestones.length, 30, "capped")
		assert.equal(s.truncated, true, "and says so, so the full worklog stays reachable")
		assert.match((s.milestones[29] as any).text, /step 39/, "the newest rows are the ones kept")
		fs.rmSync(many.root, { recursive: true, force: true })
	})

	test("packed knowledge + baseline surface for the posted state; fingerprint ignores the ticking clock", () => {
		const { root } = uiFixture({ status: "pending", observations: [{ t: T(0), event: "snapshot" }] })
		const s = buildHandoverUiState(root, CONDUCTOR).strip!
		assert.equal(s.packed.bits, 2)
		assert.equal(s.packed.governing?.title, "Test & Validate Workflow")
		assert.equal(s.packed.governing?.author, "Omar Morceli")
		assert.equal(s.baseline.created, true)
		assert.equal(s.baseline.snapshots, 1)
		assert.match(s.pickupPrompt, /Check the Adsum inbox/)

		// the push gate must not fire just because `sinceSec` advanced
		const a = buildHandoverUiState(root, CONDUCTOR, Date.parse(T(9)))
		const b = buildHandoverUiState(root, CONDUCTOR, Date.parse(T(9)) + 4000)
		assert.equal(handoverUiFingerprint(a), handoverUiFingerprint(b), "a quiet tick costs nothing")
		fs.rmSync(root, { recursive: true, force: true })
	})

	test("empty/absent handover root → no strip, conductor still reported", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-empty-ui-"))
		const s = buildHandoverUiState(root, CONDUCTOR)
		assert.equal(s.strip, null)
		assert.deepEqual(s.conductor, CONDUCTOR)
		assert.equal(buildHandoverUiState(path.join(root, "nope"), CONDUCTOR).strip, null, "missing dir never throws")
		fs.rmSync(root, { recursive: true, force: true })
	})
})

describe("developer→agent messages — delivered at the next milestone, never twice", () => {
	test("queued messages ride the checkpoint response, become ledger facts, and the queue empties", async () => {
		const { root, id } = richFixture()
		fs.writeFileSync(
			path.join(root, id, "messages.jsonl"),
			`${JSON.stringify({ t: "2026-07-19T10:00:00Z", text: "prefer pytest over unity" })}\n`,
		)
		const c = mcpClient(root)
		try {
			await c.call("initialize", { protocolVersion: "2025-06-18" })
			await c.call("tools/call", { name: "resume_handover", arguments: {} })
			// resume already drained the pre-pickup queue
			const events = fs
				.readFileSync(path.join(root, id, "ledger.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))
			assert.ok(events.some((e) => e.event === "dev_message" && e.text === "prefer pytest over unity"))
			assert.ok(!fs.existsSync(path.join(root, id, "messages.jsonl")), "queue file deleted — no double delivery")

			// a message typed mid-flight lands in the NEXT checkpoint's response
			fs.writeFileSync(
				path.join(root, id, "messages.jsonl"),
				`${JSON.stringify({ t: "2026-07-19T10:05:00Z", text: "ship it when green" })}\n`,
			)
			const ck = await c.call("tools/call", {
				name: "checkpoint",
				arguments: { worklog: "suite running", step: "off-plan", tools_used: ["adsum.build"] },
			})
			const text = ck.result.content[0].text
			assert.match(text, /Message from the developer/, "delivery happens in the milestone response")
			assert.match(text, /ship it when green/)
			assert.ok(!fs.existsSync(path.join(root, id, "messages.jsonl")))
			// and the builder renders both as delivered "you" rows
			const rows = buildHandoverUiState(root, CONDUCTOR).strip!.milestones.filter((r) => r.kind === "msg") as any[]
			assert.equal(rows.length, 2)
			assert.ok(rows.every((r) => r.delivered === true))
		} finally {
			c.kill()
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	test("an undelivered queue renders as a queued 'you' row", () => {
		const { root, id } = uiFixture({ status: "active", ledger: [{ t: T(1), event: "resume" }] })
		fs.writeFileSync(
			path.join(root, id, "messages.jsonl"),
			`${JSON.stringify({ t: T(2), text: "check the Kconfig first" })}\n`,
		)
		const rows = buildHandoverUiState(root, CONDUCTOR).strip!.milestones.filter((r) => r.kind === "msg") as any[]
		assert.equal(rows.length, 1)
		assert.equal(rows[0].delivered, false, "still queued — the view must say so, not imply the agent saw it")
		fs.rmSync(root, { recursive: true, force: true })
	})
})

describe("conductor-mode invariant — the handover plane never calls inference", () => {
	test("no inference API surface in the server or the pure brief module", () => {
		for (const f of [SERVER, path.join(__dirname, "HandoverBrief.ts")]) {
			const src = fs.readFileSync(f, "utf8")
			assert.ok(
				!/fetch\s*\(|axios|node:https|api\.anthropic|openai|x-api-key/i.test(src),
				`${path.basename(f)} stays inference-free`,
			)
		}
	})
})
