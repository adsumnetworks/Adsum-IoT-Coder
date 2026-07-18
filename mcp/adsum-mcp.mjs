#!/usr/bin/env node
/**
 * Adsum MCP server — the handover seam (H1).
 *
 * When a developer hands an Adsum session to their own coding agent (Claude Code first, but nothing
 * here is Claude-specific), THIS is what the agent talks to. It serves the mission brief, the curated
 * knowledge bits that session was using — each one carrying its author's credit line — and records
 * every call so the extension can track the session it handed away.
 *
 * Deliberately ZERO dependencies and plain Node ESM: it is spawned by a foreign agent, on a machine
 * whose toolchain we do not control, so it must run anywhere Node ≥18 runs. MCP over stdio is
 * newline-delimited JSON-RPC 2.0 (one JSON message per line — no LSP Content-Length framing).
 *
 * Contract with the extension (see HandoverService): ~/.adsum/handovers/<id>/
 *   brief.json   written by the extension  — mission, worklog, env, and the embedded k-bit closure
 *   state.json   read/written by both      — status: pending → active → returned
 *   ledger.jsonl append-only, by us        — one JSON event per line; the extension tails it live
 *
 * Bookkeeping must never break a tool call: every fs write is guarded.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const argv = process.argv.slice(2)
const flag = (name) => {
	const i = argv.indexOf(name)
	return i >= 0 ? argv[i + 1] : undefined
}
const HANDOVER_ROOT = flag("--handover-dir") || path.join(os.homedir(), ".adsum", "handovers")
const SERVER_VERSION = "0.1.0"

// ── handover store ────────────────────────────────────────────────────────────
const dirOf = (id) => path.join(HANDOVER_ROOT, id)
const readJson = (p, fallback = null) => {
	try {
		return JSON.parse(fs.readFileSync(p, "utf8"))
	} catch {
		return fallback
	}
}
const writeJson = (p, v) => {
	try {
		fs.mkdirSync(path.dirname(p), { recursive: true })
		fs.writeFileSync(p, JSON.stringify(v, null, 1))
	} catch {}
}

/** Append one event to the ledger. The extension tails this file — it is the ONLY honest record of
 *  what the foreign agent actually did (self-reported progress is not evidence). */
function ledger(id, event) {
	try {
		fs.mkdirSync(dirOf(id), { recursive: true })
		fs.appendFileSync(path.join(dirOf(id), "ledger.jsonl"), JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n")
	} catch {}
}

function patchState(id, patch) {
	const p = path.join(dirOf(id), "state.json")
	const cur = readJson(p, {}) ?? {}
	writeJson(p, { ...cur, ...patch, lastToolAt: new Date().toISOString() })
}

/** Newest handover whose state is `pending` (the one the extension just wrote), else newest overall. */
function newestHandover() {
	let dirs = []
	try {
		dirs = fs
			.readdirSync(HANDOVER_ROOT, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => ({ id: e.name, m: fs.statSync(path.join(HANDOVER_ROOT, e.name)).mtimeMs }))
			.sort((a, b) => b.m - a.m)
	} catch {
		return null
	}
	const pending = dirs.find((d) => (readJson(path.join(HANDOVER_ROOT, d.id, "state.json"), {}) ?? {}).status === "pending")
	return (pending ?? dirs[0])?.id ?? null
}

// ── attribution ───────────────────────────────────────────────────────────────
/** The credit line. Attribution has to survive leaving our UI, so it is IN-BAND: the first line of
 *  every skill we serve. Whatever the host agent renders, the credit is in the tool result. */
const credit = (b) =>
	`📚 ${b.title || b.id} v${b.version || "?"} — curated by ${b.author || "Adsum"}` +
	(b.witnessed ? ` · witnessed on ${b.witnessed}` : "")

// ── tools ─────────────────────────────────────────────────────────────────────
const TOOLS = [
	{
		name: "inbox",
		description:
			"Check the Adsum inbox: work the developer posted for you from the Adsum IoT Coder extension (handed-over sessions waiting to be picked up). Call this when the developer says to check the Adsum inbox, at the start of a session in this project, or after finishing a task. If a handover is pending, resume it with resume_handover.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "resume_handover",
		description:
			"Resume an Adsum IoT Coder session that was handed over to you. Returns the mission brief (what the task is, what has been done, what is next) and the curated knowledge bits available for it. CALL THIS FIRST, before any other work on this project.",
		inputSchema: {
			type: "object",
			properties: { handover_id: { type: "string", description: "Handover id; omit to resume the newest pending one." } },
		},
	},
	{
		name: "load_skill",
		description:
			"Load a curated Adsum knowledge bit (workflow, action, or reference) by id or keyword. Call this BEFORE acting on any nRF/ESP/embedded task — these bits are hardware-verified and supersede general knowledge. The result starts with the author's credit line; surface it once in your reply.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Bit id (e.g. adsum/nrf/actions/build) or a keyword (e.g. flash, sniffer).",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "checkpoint",
		description:
			"Record a milestone back to the Adsum session (keeps the developer's extension in sync and makes returning to Adsum lossless). Call at each meaningful step: what you just established or changed.",
		inputSchema: {
			type: "object",
			properties: { worklog: { type: "string", description: "One line: what was just accomplished." } },
			required: ["worklog"],
		},
	},
]

function toolInbox() {
	let dirs = []
	try {
		dirs = fs
			.readdirSync(HANDOVER_ROOT, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
	} catch {}
	const items = []
	for (const id of dirs) {
		const st = readJson(path.join(dirOf(id), "state.json"), {}) ?? {}
		const brief = readJson(path.join(dirOf(id), "brief.json"), {}) ?? {}
		items.push({
			id,
			status: st.status ?? "unknown",
			mission: brief.mission ?? "(no mission)",
			createdAt: st.createdAt,
			lastCheckpoint: st.lastCheckpoint,
		})
	}
	items.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
	const pending = items.filter((i) => i.status === "pending")
	if (!pending.length) {
		const recent = items
			.slice(0, 3)
			.map((i) => `- ${i.id} · ${i.status} · ${i.mission}${i.lastCheckpoint ? ` · last: ${i.lastCheckpoint}` : ""}`)
		return {
			text: `Adsum inbox: empty — no pending handovers.${recent.length ? `\nRecent sessions:\n${recent.join("\n")}` : ""}`,
		}
	}
	return {
		text: [
			`Adsum inbox: ${pending.length} pending handover${pending.length === 1 ? "" : "s"} from the developer.`,
			...pending.map((i) => `- **${i.id}** — ${i.mission} (posted ${i.createdAt ?? "?"})`),
			"",
			`Pick it up now: call resume_handover${pending.length === 1 ? ` with handover_id "${pending[0].id}" (or no args)` : " with the id you want"} and continue the mission it returns.`,
		].join("\n"),
	}
}

function toolResumeHandover(args) {
	const id = args?.handover_id || newestHandover()
	if (!id) {
		return {
			isError: true,
			text: `No Adsum handover found under ${HANDOVER_ROOT}. Ask the developer to run "Adsum: Hand session to my coding agent" in VS Code.`,
		}
	}
	const brief = readJson(path.join(dirOf(id), "brief.json"))
	if (!brief) {
		return {
			isError: true,
			text: `Handover "${id}" has no brief.json — it may be from an older version. Re-run the handover from the Adsum extension.`,
		}
	}

	const bits = brief.bits ?? []
	const lines = [
		`# Adsum handover ${id}`,
		"",
		`**Mission:** ${brief.mission || "(not stated)"}`,
		brief.workspace ? `**Workspace:** ${brief.workspace}` : null,
		brief.env ? `**Environment:** ${brief.env}` : null,
		"",
		"## Done so far (by the Adsum agent)",
		brief.worklog?.length ? brief.worklog.map((w) => `- ${w}`).join("\n") : "- (fresh start — nothing done yet)",
		"",
		"## Next step",
		brief.nextStep || "(open — decide with the developer)",
		"",
		"## Curated knowledge available (call load_skill to load one)",
		bits.length
			? bits.map((b) => `- \`${b.id}\` — ${b.title || ""}\n  ${credit(b)}`).join("\n")
			: "- (none pinned — load_skill will report what it can find)",
		"",
		"**How to work here:** load the relevant bit with `load_skill` BEFORE acting, follow its steps rather than improvising, surface each bit's credit line once when you first use it, and call `checkpoint` at each milestone so the developer's Adsum session stays in sync.",
	]
	patchState(id, { status: "active", resumedAt: new Date().toISOString() })
	ledger(id, { event: "resume", bits: bits.length })
	return { text: lines.filter((l) => l !== null).join("\n") }
}

function toolLoadSkill(args, ctx) {
	const id = ctx.activeId || newestHandover()
	if (!id) {
		return { isError: true, text: "No active Adsum handover — call resume_handover first." }
	}
	const brief = readJson(path.join(dirOf(id), "brief.json"), {}) ?? {}
	const bits = brief.bits ?? []
	const q = String(args?.query ?? "")
		.trim()
		.toLowerCase()
	if (!q) {
		return { isError: true, text: "load_skill needs a query (a bit id or a keyword)." }
	}

	// exact id → id substring → keyword in title/triggers. Deterministic, cheapest-first.
	const hit =
		bits.find((b) => b.id.toLowerCase() === q) ??
		bits.find((b) => b.id.toLowerCase().includes(q)) ??
		bits.find((b) => (b.title || "").toLowerCase().includes(q)) ??
		bits.find((b) => (b.triggers || []).some((t) => String(t).toLowerCase().includes(q)))

	if (!hit) {
		return {
			isError: true,
			text: `No curated bit matches "${args?.query}". Available in this session:\n${bits.map((b) => `- ${b.id} — ${b.title || ""}`).join("\n") || "(none)"}`,
		}
	}
	ledger(id, { event: "kbit_load", id: hit.id, title: hit.title, version: hit.version, author: hit.author })
	patchState(id, {})
	return {
		text: `${credit(hit)}\n\n${hit.body || "(body unavailable — the bit is entitlement-gated or was not cached at handover time)"}`,
	}
}

function toolCheckpoint(args, ctx) {
	const id = ctx.activeId || newestHandover()
	if (!id) {
		return { isError: true, text: "No active Adsum handover — call resume_handover first." }
	}
	const worklog = String(args?.worklog ?? "").trim()
	if (!worklog) {
		return { isError: true, text: "checkpoint needs a worklog line." }
	}
	ledger(id, { event: "checkpoint", worklog })
	patchState(id, { lastCheckpoint: worklog, lastCheckpointAt: new Date().toISOString() })
	return { text: `✓ checkpoint synced to Adsum session ${id}` }
}

// ── JSON-RPC plumbing ─────────────────────────────────────────────────────────
const ctx = { activeId: null }
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n")
const reply = (id, result) => send({ jsonrpc: "2.0", id, result })
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } })

function handle(msg) {
	const { id, method, params } = msg
	if (method === "initialize") {
		return reply(id, {
			// Echo the client's protocol version — the spec's compatibility rule, and it keeps this
			// server working across MCP revisions without a version table to maintain.
			protocolVersion: params?.protocolVersion || "2024-11-05",
			capabilities: { tools: {} },
			serverInfo: { name: "adsum", version: SERVER_VERSION },
		})
	}
	if (method === "notifications/initialized" || method === "notifications/cancelled") {
		return // notifications get no reply
	}
	if (method === "ping") {
		return reply(id, {})
	}
	if (method === "tools/list") {
		return reply(id, { tools: TOOLS })
	}
	if (method === "tools/call") {
		const name = params?.name
		const args = params?.arguments ?? {}
		let out
		try {
			if (name === "inbox") out = toolInbox()
			else if (name === "resume_handover") {
				out = toolResumeHandover(args)
				if (!out.isError) {
					ctx.activeId = args?.handover_id || newestHandover()
				}
			} else if (name === "load_skill") {
				out = toolLoadSkill(args, ctx)
			} else if (name === "checkpoint") {
				out = toolCheckpoint(args, ctx)
			} else {
				out = { isError: true, text: `Unknown tool "${name}".` }
			}
		} catch (e) {
			// A tool failure is a RESULT (isError), not a protocol error — the agent should see it and adapt.
			out = { isError: true, text: `adsum ${name} failed: ${e?.message || e}` }
		}
		return reply(id, { content: [{ type: "text", text: out.text }], isError: !!out.isError })
	}
	if (id !== undefined) {
		fail(id, -32601, `Method not found: ${method}`)
	}
}

let buf = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
	buf += chunk
	let nl
	while ((nl = buf.indexOf("\n")) >= 0) {
		const line = buf.slice(0, nl).trim()
		buf = buf.slice(nl + 1)
		if (!line) {
			continue
		}
		let msg
		try {
			msg = JSON.parse(line)
		} catch {
			continue // a malformed line must never kill the server
		}
		try {
			handle(msg)
		} catch (e) {
			if (msg?.id !== undefined) {
				fail(msg.id, -32603, `Internal error: ${e?.message || e}`)
			}
		}
	}
})
process.stdin.on("end", () => process.exit(0))
