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
import { extractBriefParts, upsertManagedBlock } from "./HandoverBrief"

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

			// 2. tools/list — the four H1 tools with schemas
			const list = await c.call("tools/list")
			const names = list.result.tools.map((t: any) => t.name).sort()
			assert.deepEqual(names, ["checkpoint", "inbox", "load_skill", "resume_handover"])
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

			// 5. checkpoint — state + ledger
			const ck = await c.call("tools/call", { name: "checkpoint", arguments: { worklog: "repro'd 0x08 at 87s" } })
			assert.match(ck.result.content[0].text, /✓ checkpoint synced/)
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
			// the four tools now include inbox
			const list = await c.call("tools/list")
			assert.deepEqual(list.result.tools.map((t: any) => t.name).sort(), [
				"checkpoint",
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
		assert.deepEqual(b.worklog, ["enumerate devices", "build firmware"], "only COMPLETED items are 'done so far'")
		assert.equal(b.nextStep, "capture logs", "the first unchecked item is the next step")
		assert.equal(b.lastSummary, "Build passed; firmware is flashed.")
		assert.deepEqual(b.kbitRelPaths, ["platforms/nrf/workflows/debug-loop.md", "platforms/nrf/actions/flash.md"])
	})
})
