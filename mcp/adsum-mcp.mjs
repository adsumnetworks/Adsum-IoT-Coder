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
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const argv = process.argv.slice(2)
const flag = (name) => {
	const i = argv.indexOf(name)
	return i >= 0 ? argv[i + 1] : undefined
}
const HANDOVER_ROOT = flag("--handover-dir") || path.join(os.homedir(), ".adsum", "handovers")
const SERVER_VERSION = "0.2.0"

// HARD INVARIANT (conductor mode): this server NEVER calls an inference API. Everything semantic —
// which step was finished, which bit to load next — is pushed to the CALLER via tool schemas (the
// agent has the model; we are a state machine). Enforced by test: no fetch/https import may appear here.

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
/**
 * The credit line. Attribution has to survive leaving our UI, so it is IN-BAND: the first line of every
 * skill we serve. Whatever the host agent chooses to render, the credit is in the tool result.
 *
 * The FACTS are decided extension-side (services/knowledge/kbit/credit.ts) and written into the brief —
 * including the honest fallback, so a bit nobody personally claimed is credited to the authoring team
 * rather than to a placeholder handle. This server only formats what it was given; it must never invent
 * an author or restate a bit's kind as a verdict.
 */
const credit = (b) => {
	const glyph = b.kind === "tool" ? "⚙" : "◆"
	const ver = b.version ? ` v${b.version}` : ""
	const steward = b.steward && b.attributed ? ` · steward ${b.steward}` : ""
	return `${glyph} ${b.title || b.id}${ver} — curated by ${b.author || "the Adsum authoring team"}${steward}`
}

// ── tools ─────────────────────────────────────────────────────────────────────
/** The brief that governs tool schemas right now (active handover, else newest). */
function currentBrief(ctx) {
	const id = ctx?.activeId || newestHandover()
	return id ? readJson(path.join(dirOf(id), "brief.json"), null) : null
}

/**
 * The tool list is built per call: the checkpoint schema's `step` enum comes from the governing
 * workflow's parsed steps, so the AGENT classifies which step it finished (the model is on their side
 * of the wire) and this server just advances a state machine. That is what makes the interrogation
 * loop work with zero inference on our side.
 */
function buildTools(ctx) {
	const brief = currentBrief(ctx)
	const steps = Array.isArray(brief?.steps) ? brief.steps : []
	const stepEnum = [...steps, "off-plan"]
	return [
		{
			name: "inbox",
			description:
				"Check the Adsum inbox: work the developer posted for you from the Adsum IoT Coder extension (handed-over sessions waiting to be picked up). Call this when the developer says to check the Adsum inbox, at the start of a session in this project, or after finishing a task. If a handover is pending, resume it with resume_handover.",
			inputSchema: { type: "object", properties: {} },
		},
		{
			name: "resume_handover",
			description:
				"Resume an Adsum IoT Coder session that was handed over to you. Returns the mission brief (what the task is, the governing workflow and its steps, what has been done, what is next) and the curated knowledge available. CALL THIS FIRST, before any other work on this project.",
			inputSchema: {
				type: "object",
				properties: {
					handover_id: { type: "string", description: "Handover id; omit to resume the newest pending one." },
				},
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
				"Report a milestone back to the Adsum session — call at EVERY milestone AND after ANY file mutation (create/edit/delete), and answer what the response asks. Before you stop working, send a closing checkpoint with final: true, the files you touched, and the honest next step.",
			inputSchema: {
				type: "object",
				properties: {
					worklog: { type: "string", description: "One line: what was just accomplished." },
					handover_id: {
						type: "string",
						description:
							"Only needed if you have not called resume_handover in this session — the id of the session this milestone belongs to.",
					},
					step: {
						type: "string",
						...(steps.length ? { enum: stepEnum } : {}),
						description:
							"Which workflow step this milestone completes (pick from the governing workflow's steps; 'off-plan' if it maps to none — and say why in worklog).",
					},
					tools_used: {
						type: "array",
						items: { type: "string", enum: ["adsum.exec", "adsum.build", "own_terminal", "editor_tools", "none"] },
						description:
							"Which tools did the work since the last checkpoint. Be honest — own_terminal is allowed but tracked.",
					},
					files_touched: {
						type: "array",
						items: { type: "string" },
						description: "Files created/edited/deleted since the last checkpoint (workspace-relative).",
					},
					final: { type: "boolean", description: "true for the closing checkpoint before you stop working." },
					next_step: {
						type: "string",
						description: "Closing checkpoint only: the honest next step for whoever resumes.",
					},
				},
				required: ["worklog", "step", "tools_used"],
			},
		},
		{
			name: "exec",
			description:
				"Run a toolchain command (idf.py, esptool, west, serial-port checks) WITH the embedded environment sourced — a plain shell does not have it and bare idf.py will fail with command-not-found. Use this (or build) for every embedded command; never install or repair a toolchain yourself.",
			inputSchema: {
				type: "object",
				properties: {
					command: {
						type: "string",
						description: "The full command, e.g. 'idf.py --version' or 'idf.py set-target esp32c6'.",
					},
					cwd: { type: "string", description: "Working directory (defaults to the handover workspace)." },
				},
				required: ["command"],
			},
		},
		{
			name: "build",
			description:
				"Build the firmware (idf.py build) with the embedded environment sourced, and report the result. Run this after ANY source change before claiming a step done — a build is the gate that catches a missing include in seconds.",
			inputSchema: {
				type: "object",
				properties: {
					cwd: { type: "string", description: "Project directory to build (defaults to the handover workspace)." },
				},
			},
		},
	]
}

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
	const governing = bits.find((b) => b.id === brief.governing)
	const spokes = bits.filter((b) => b.id !== brief.governing)
	const steps = Array.isArray(brief.steps) ? brief.steps : []
	const index = Array.isArray(brief.index) ? brief.index : []
	const unresolved = Array.isArray(brief.unresolved) ? brief.unresolved : []
	const bitLine = (b) => `- \`${b.id}\` — ${b.title || ""}${b.via ? ` *(via ${b.via.split("/").pop()})*` : ""}\n  ${credit(b)}`
	const lines = [
		`# Adsum handover ${id}`,
		"",
		`**Mission:** ${brief.mission || "(not stated)"}`,
		brief.workspace ? `**Workspace:** ${brief.workspace}` : null,
		brief.env ? `**Environment:** ${brief.env}` : null,
		brief.baseline?.ref
			? `**Git baseline:** ${brief.baseline.ref.slice(0, 10)} (snapshots ${brief.baseline.managed ? "managed by Adsum" : "owned by the developer"})`
			: null,
		"",
		"## Done so far (by the Adsum agent)",
		brief.worklog?.length ? brief.worklog.map((w) => `- ${w}`).join("\n") : "- (fresh start — nothing done yet)",
		"",
		"## Next step",
		brief.nextStep || "(open — decide with the developer)",
		"",
		...(governing
			? [
					"## ★ Governing workflow — this owns the mission; everything below serves it",
					bitLine(governing),
					...(steps.length
						? [
								"",
								"Its steps (report each completed one via `checkpoint` with the matching `step`):",
								...steps.map((s) => `- [ ] ${s}`),
							]
						: []),
					"",
				]
			: []),
		spokes.length
			? `## ◆ Its knowledge closure (bodies pinned — call load_skill before acting)\n${spokes.map(bitLine).join("\n")}`
			: null,
		unresolved.length
			? `## ⚠ Referenced but not bundled in this handover\n${unresolved.map((u) => `- \`${u.id}\` (referenced by ${u.via}) — on the registry; ask the developer if you need it`).join("\n")}`
			: null,
		index.length
			? `## ≡ Also available (full field of view — metadata only, load_skill fetches the body)\n${index.map((e) => `- \`${e.id}\`${e.title ? ` — ${e.title}` : ""}${e.author ? ` · ${e.author}` : ""}`).join("\n")}`
			: null,
		"",
		"**How to work here:** load the relevant bit with `load_skill` BEFORE acting and follow its steps rather than improvising; surface each bit's credit line once when you first use it; run every embedded command through `exec`/`build` (they carry the toolchain environment — a bare `idf.py` in your own shell will fail); call `checkpoint` at every milestone AND after any file mutation, answering what its response asks; and before you stop, send a closing checkpoint (`final: true`) with the files you touched and the honest next step.",
	]
	patchState(id, { status: "active", resumedAt: new Date().toISOString(), currentStepIdx: -1 })
	ledger(id, { event: "resume", bits: bits.length, governing: brief.governing, steps: steps.length })
	// Messages queued while nobody had picked the session up are delivered with the resume itself.
	const queued = drainDeveloperMessages(id)
	if (queued.length) {
		lines.push("", "**Message from the developer:**", ...queued.map((m) => `> ${m}`))
	}
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

	const FOOTER =
		"\n\n---\n*Follow the steps above rather than improvising. Embedded commands go through `exec`/`build`. Report back with `checkpoint` at the next milestone and after any file mutation.*"

	if (hit) {
		ledger(id, {
			event: "kbit_load",
			id: hit.id,
			title: hit.title,
			version: hit.version,
			author: hit.author,
			source: "closure",
		})
		patchState(id, {})
		return {
			text: `${credit(hit)}\n\n${hit.body || "(body unavailable — the bit is entitlement-gated or was not cached at handover time)"}${FOOTER}`,
		}
	}

	// ≡ manifest-index fallback: the bit wasn't in the closure but IS in this install's field of view.
	// Bundled bits carry an absolute path a zero-dep reader can serve; strip frontmatter, bridge the
	// read_file idiom (same rewrite the extension applies), and credit from the index metadata.
	const index = Array.isArray(brief.index) ? brief.index : []
	const ihit =
		index.find((e) => e.id.toLowerCase() === q) ??
		index.find((e) => e.id.toLowerCase().includes(q)) ??
		index.find((e) => (e.title || "").toLowerCase().includes(q))
	if (ihit?.path) {
		let body = ""
		try {
			body = fs.readFileSync(ihit.path, "utf8")
		} catch {}
		if (body) {
			body = body.replace(/^---\n[\s\S]*?\n---\n/, "") // frontmatter off
			const plat = ihit.id.replace(/^adsum\//, "").split("/")[0]
			body = body.replace(
				/`?read_file`?\s*(?:→|->)\s*`?((?:platforms\/|(?:actions|workflows|rules|references|knowledges|sdks|boards|protocols)\/)[\w/-]+\.md)`?/gi,
				(_m, p) =>
					`call \`load_skill("adsum/${(p.startsWith("platforms/") ? p.slice(10) : `${plat}/${p}`).replace(/\.md$/i, "").toLowerCase()}")\``,
			)
			ledger(id, { event: "kbit_load", id: ihit.id, title: ihit.title, author: ihit.author, source: "index" })
			patchState(id, {})
			return { text: `${credit({ ...ihit, kind: ihit.kind === "tool" ? "tool" : "knowledge" })}\n\n${body}${FOOTER}` }
		}
	}
	if (ihit) {
		return {
			isError: true,
			text: `\`${ihit.id}\` exists but its body is not available offline in this handover (it lives on the registry). Ask the developer to include it, or proceed with the pinned closure.`,
		}
	}
	return {
		isError: true,
		text: `No curated bit matches "${args?.query}". Pinned in this session:\n${bits.map((b) => `- ${b.id} — ${b.title || ""}`).join("\n") || "(none)"}${
			index.length
				? `\nAlso indexed: ${index
						.slice(0, 15)
						.map((e) => e.id)
						.join(", ")}${index.length > 15 ? ", …" : ""}`
				: ""
		}`,
	}
}

/**
 * Deliver anything the developer typed while the agent was working. MCP cannot push, so the extension
 * queues messages in messages.jsonl and the agent receives them HERE — in the response to its next
 * milestone (exactly what the composer promises). Delivery is a ledger fact; the queue file is deleted
 * so a message is never delivered twice.
 */
function drainDeveloperMessages(id) {
	const p = path.join(dirOf(id), "messages.jsonl")
	let msgs = []
	try {
		msgs = fs
			.readFileSync(p, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => {
				try {
					return JSON.parse(l)
				} catch {
					return null
				}
			})
			.filter((m) => m && typeof m.text === "string")
	} catch {
		return []
	}
	if (!msgs.length) {
		return []
	}
	try {
		fs.unlinkSync(p)
	} catch {}
	for (const m of msgs) {
		ledger(id, { event: "dev_message", text: m.text })
	}
	return msgs.map((m) => m.text)
}

/**
 * The milestone dialogue (H2.1 v1, reminder-strength). MCP servers cannot speak first, so every
 * checkpoint RESPONSE carries the interrogation: where the agent is in the governing workflow, what
 * comes next, and the standing bit/tool checks. All of it is a template over parsed steps + reported
 * enums — deterministic, zero inference (conductor-mode invariant).
 */
function toolCheckpoint(args, ctx) {
	// A WRITE must never guess its session. Falling back to "newest" once routed a closing checkpoint
	// for one handover into a different one that happened to be posted more recently — the two sessions'
	// histories crossed and the real one lost its closure. Reads may be global; writes must be addressed.
	const id = args?.handover_id || ctx.activeId
	if (!id) {
		return {
			isError: true,
			text: "I do not know which session this belongs to. Call resume_handover first (or pass handover_id) — recording a milestone against the wrong session would corrupt both.",
		}
	}
	if (!readJson(path.join(dirOf(id), "brief.json"))) {
		return { isError: true, text: `No handover "${id}" on this machine.` }
	}
	const worklog = String(args?.worklog ?? "").trim()
	if (!worklog) {
		return { isError: true, text: "checkpoint needs a worklog line." }
	}
	const brief = readJson(path.join(dirOf(id), "brief.json"), {}) ?? {}
	const steps = Array.isArray(brief.steps) ? brief.steps : []
	const step = String(args?.step ?? "").trim()
	const toolsUsed = Array.isArray(args?.tools_used) ? args.tools_used : []
	const filesTouched = Array.isArray(args?.files_touched) ? args.files_touched : []
	const final = !!args?.final
	ledger(id, {
		event: "checkpoint",
		worklog,
		step: step || undefined,
		tools_used: toolsUsed.length ? toolsUsed : undefined,
		files_touched: filesTouched.length ? filesTouched : undefined,
		final: final || undefined,
		next_step: args?.next_step ? String(args.next_step) : undefined,
	})
	const stepIdx = steps.indexOf(step)
	const st = readJson(path.join(dirOf(id), "state.json"), {}) ?? {}
	patchState(id, {
		lastCheckpoint: worklog,
		lastCheckpointAt: new Date().toISOString(),
		currentStepIdx: stepIdx >= 0 ? Math.max(stepIdx, st.currentStepIdx ?? -1) : (st.currentStepIdx ?? -1),
		...(final ? { status: "closed-by-agent", closedAt: new Date().toISOString() } : {}),
	})

	const out = [`✓ Recorded to Adsum session ${id}.`]
	// The developer may have typed messages since the last milestone — this response IS the delivery.
	const devMsgs = drainDeveloperMessages(id)
	if (devMsgs.length) {
		out.push("", "**Message from the developer:**", ...devMsgs.map((m) => `> ${m}`), "", "Address this before continuing.")
	}
	if (final) {
		out.push(
			"",
			"Closing checkpoint accepted — the developer can now resume this session in Adsum without loss." +
				(filesTouched.length
					? ""
					: " You reported no touched files; if you edited anything, send one more checkpoint listing them."),
		)
		return { text: out.join("\n") }
	}
	// Position + next step (the workflow question)
	if (stepIdx >= 0) {
		const next = steps[stepIdx + 1]
		out.push("", `Per ★ ${brief.governing || "the governing workflow"} you completed **${step}**.`)
		out.push(
			next
				? `Next is **${next}** — load the bit that owns it with \`load_skill\` BEFORE acting, and name it in your next checkpoint.`
				: "That was the last parsed step — verify the workflow's summary/closing requirements before stopping, then send a closing checkpoint (final: true).",
		)
	} else if (step === "off-plan" || !steps.length) {
		out.push(
			"",
			steps.length
				? "You reported **off-plan** work. If the plan no longer fits, say why in the next checkpoint — otherwise return to the governing workflow's next unfinished step (see resume_handover's checklist)."
				: "No parsed steps for this handover — follow the governing bit's own ordering.",
		)
	}
	// Tool check (the drift question)
	if (toolsUsed.includes("own_terminal_toolchain")) {
		out.push(
			"",
			"⚠ A toolchain command ran outside `exec`/`build`. Those carry the embedded environment and keep the developer's record complete — which command was it, and did it need something exec/build could not give you?",
		)
	}
	// Mutation check (the safety question)
	if (filesTouched.length) {
		out.push(
			"",
			`Mutation noted (${filesTouched.length} file${filesTouched.length === 1 ? "" : "s"}). Run \`build\` before claiming this step done — a build catches a missing include in seconds. A snapshot is being taken on the developer's side.`,
		)
	}
	out.push("", "Report back at the next milestone — and after any file mutation.")
	return { text: out.join("\n") }
}

// ── t-bits: exec + build — the environment the foreign agent NEEDS ────────────
// The strongest adherence lever is usefulness: the agent must come to us for a working toolchain, and
// every visit lands in the ledger. Guard rail: this server never installs or repairs a toolchain —
// mutating ~/.espressif is the developer's call, always.
const INSTALL_GUARD =
	/install\.sh|idf_tools\.py\s+install|espup\s+install|rustup|brew\s+install|apt(-get)?\s+install|pip3?\s+install/i

function envPrefix(brief) {
	const activate = brief?.idf?.activate
	if (activate && fs.existsSync(activate)) {
		return `source ${JSON.stringify(activate)} >/dev/null 2>&1 && `
	}
	if (process.env.IDF_PATH && fs.existsSync(path.join(process.env.IDF_PATH, "export.sh"))) {
		return `source ${JSON.stringify(path.join(process.env.IDF_PATH, "export.sh"))} >/dev/null 2>&1 && `
	}
	return null
}

function runInEnv(id, brief, command, cwd, eventName) {
	if (INSTALL_GUARD.test(command)) {
		ledger(id, { event: eventName, command, exit: -1, refused: "install-guard" })
		return {
			isError: true,
			text: "Refused: that command installs or mutates a toolchain. Installing is the developer's call — report exactly what is missing (checkpoint) and ask them, per the esp-terminal rule. Never repair a global toolchain unprompted.",
		}
	}
	const prefix = envPrefix(brief)
	if (prefix === null) {
		ledger(id, { event: eventName, command, exit: -1, refused: "no-environment" })
		return {
			isError: true,
			text: "The embedded toolchain environment could not be located on this machine (no activation script was found at handover, and IDF_PATH is unset). Do NOT install anything or improvise sourcing — checkpoint this finding and ask the developer to point Adsum at their ESP-IDF setup, then retry.",
		}
	}
	const wd = cwd || brief?.workspace || process.cwd()
	const r = spawnSync("bash", ["-lc", `${prefix}cd ${JSON.stringify(wd)} && ${command}`], {
		encoding: "utf8",
		timeout: 300_000,
		maxBuffer: 8 * 1024 * 1024,
	})
	const exit = r.status ?? (r.signal ? -1 : 0)
	const tail = (s, n) => {
		const t = (s || "").trim()
		return t.length > n ? `…\n${t.slice(-n)}` : t
	}
	// A failing build's TAIL is usually a sub-project succeeding — the real error sits above the cut.
	// Live evidence: a compile failure showed only the bootloader linking, so the agent had to grep the
	// log files with its own shell, and our own drift nudge then fired at it. Surface the error lines.
	const ERR_RE =
		/(?:^|\s)(error:|fatal error:|undefined reference|No such file|multiple definition|region `?\w+'? overflowed|does not fit|ninja: build stopped)/i
	const errorLines = (s) => {
		const hits = (s || "")
			.split("\n")
			.filter((l) => ERR_RE.test(l) && !/^\s*\[\d+\/\d+\]/.test(l))
			.map((l) => l.trim())
		return [...new Set(hits)].slice(0, 12)
	}
	ledger(id, { event: eventName, command, cwd: wd, exit })
	patchState(id, {})
	const body = [
		`$ ${command}   (cwd: ${wd})`,
		tail(r.stdout, 6000),
		r.stderr ? `--- stderr ---\n${tail(r.stderr, 2000)}` : "",
		`exit ${exit}`,
	]
		.filter(Boolean)
		.join("\n")
	return { isError: exit !== 0, text: body }
}

function toolExec(args, ctx) {
	const id = ctx.activeId
	if (!id) {
		return {
			isError: true,
			text: "No active Adsum handover — call resume_handover first so this run is recorded against the right session.",
		}
	}
	const command = String(args?.command ?? "").trim()
	if (!command) {
		return { isError: true, text: "exec needs a command." }
	}
	const brief = readJson(path.join(dirOf(id), "brief.json"), {}) ?? {}
	return runInEnv(id, brief, command, args?.cwd, "tool_exec")
}

function toolBuild(args, ctx) {
	const id = ctx.activeId
	if (!id) {
		return {
			isError: true,
			text: "No active Adsum handover — call resume_handover first so this run is recorded against the right session.",
		}
	}
	const brief = readJson(path.join(dirOf(id), "brief.json"), {}) ?? {}
	return runInEnv(id, brief, "idf.py build", args?.cwd, "tool_build")
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
		return reply(id, { tools: buildTools(ctx) })
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
					const next = args?.handover_id || newestHandover()
					const changed = next !== ctx.activeId
					ctx.activeId = next
					// The checkpoint schema's step enum is built from THIS handover's workflow, and clients
					// cache tools/list from session start. Without this notification an agent resuming a
					// second session keeps the first one's steps and is forced to report "off-plan" for
					// real work — seen live: a 6-step workflow offered only "Step 0" and "off-plan".
					if (changed) {
						send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })
					}
				}
			} else if (name === "load_skill") {
				out = toolLoadSkill(args, ctx)
			} else if (name === "checkpoint") {
				out = toolCheckpoint(args, ctx)
			} else if (name === "exec") {
				out = toolExec(args, ctx)
			} else if (name === "build") {
				out = toolBuild(args, ctx)
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
