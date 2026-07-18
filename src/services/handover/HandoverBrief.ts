/**
 * Handover brief — the PURE half (no vscode, no I/O beyond the two file helpers), so it is directly
 * testable and reusable when a second agent lands (H5).
 *
 * The design rule that matters here: we hand over a BRIEF, never a transcript. A transcript would burn
 * the receiving agent's context on history it doesn't need and is agent-specific anyway; the brief is
 * small, model-agnostic, and the Adsum agent — which knows the session state — produces it for free.
 */
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

// The begin marker carries a fingerprint of the text WE wrote. That makes the file self-describing:
// on the next write we can tell "unchanged since we wrote it" from "the developer edited our block"
// without keeping any state on our side — and a developer's words are never overwritten.
const BEGIN_RE = /<!-- adsum:managed:begin[^>]*-->/
const beginMarker = (fp: string) => `<!-- adsum:managed:begin fp=${fp} — written by Adsum IoT Coder; edit outside this block -->`
const END = "<!-- adsum:managed:end -->"
const fingerprint = (s: string) => createHash("sha256").update(s.trim()).digest("hex").slice(0, 12)

export interface BriefParts {
	mission: string
	worklog: string[]
	nextStep: string
	lastSummary: string
	/** kbits the session ACTUALLY read, as iot-knowledge-relative paths (→ ids via deriveIdFromRel). */
	kbitRelPaths: string[]
}

/** Extract the brief's raw parts from a recorded session (ui_messages + task_metadata shapes). */
export function extractBriefParts(ui: any[], meta: any): BriefParts {
	const say = (m: any, kind: string) => m?.say === kind && typeof m.text === "string" && m.text.length > 0
	const texts = ui.filter((m) => say(m, "text"))
	// The opening user prompt is the first text message; the last one is the agent's latest state summary.
	const mission = texts[0]?.text?.trim() ?? ""
	const lastSummary = texts.length > 1 ? texts[texts.length - 1].text.trim() : ""

	// The agent maintains a markdown checklist in task_progress — the freshest one IS the worklog.
	// Completed items = "done so far"; the first unchecked item = the natural next step.
	const progress = [...ui].reverse().find((m) => say(m, "task_progress"))?.text ?? ""
	const items = progress
		.split(/\r?\n/)
		.map((l: string) => l.match(/^\s*-\s*\[( |x|X)\]\s*(.+?)\s*$/))
		.filter(Boolean) as RegExpMatchArray[]
	const worklog = items.filter((m) => m[1].toLowerCase() === "x").map((m) => m[2])
	const nextStep = items.find((m) => m[1] === " ")?.[2] ?? ""

	// Which curated bits this session leaned on — the closure we pin into the brief.
	const marker = "/iot-knowledge/"
	const kbitRelPaths: string[] = []
	for (const f of meta?.files_in_context ?? []) {
		const p = String(f?.path ?? "").replace(/\\/g, "/")
		const i = p.lastIndexOf(marker)
		if (i === -1) {
			continue
		}
		const rel = p.slice(i + marker.length)
		if (rel.endsWith(".md") && !kbitRelPaths.includes(rel)) {
			kbitRelPaths.push(rel)
		}
	}
	return { mission, worklog, nextStep, lastSummary, kbitRelPaths }
}

/** The instructions we ask the receiving agent to follow. H1 deliberately does NOT claim adsum build/
 *  flash tools exist (they arrive with H3) — it steers to the curated workflow + the checkpoint loop. */
export function managedBlockBody(handoverId: string): string {
	return [
		"## Adsum embedded workflow (this project)",
		"",
		`This project has an active Adsum IoT Coder handover (\`${handoverId}\`). The \`adsum\` MCP server carries the mission and the curated, hardware-verified knowledge for it.`,
		"",
		`- **Check the inbox.** At the start of a session here — and whenever the developer says "check the Adsum inbox" — call \`adsum.inbox\`. The developer posts handed-over sessions there from the extension.`,
		`- **To pick one up, call \`adsum.resume_handover\`** — it returns the mission, what has already been done, and the knowledge bits available.`,
		"- **Before acting on any nRF / ESP / embedded task, call `adsum.load_skill`** with the topic (e.g. `flash`, `sniffer`, the bit id). These bits are verified on real hardware and supersede general knowledge — follow their steps rather than improvising.",
		"- **Surface the credit line.** Every loaded bit starts with `📚 <bit> — curated by <author>`. Show it once, the first time you use that bit, so the author is credited to the developer.",
		"- **Call `adsum.checkpoint` at each milestone** with one line about what you established. This keeps the developer's Adsum session in sync and lets them continue there without losing your work.",
	].join("\n")
}

export type BlockResult = "created" | "updated" | "unchanged" | "skipped-user-edited"

/**
 * Write/refresh the managed block in a CLAUDE.md (or AGENTS.md — same mechanics, which is what makes
 * this agent-agnostic). Only ever touches text BETWEEN the markers; if the developer has edited inside
 * the block we back off rather than clobber their words.
 */
export function upsertManagedBlock(mdPath: string, body: string): BlockResult {
	const block = (b: string) => `${beginMarker(fingerprint(b))}\n${b}\n${END}`
	let existing = ""
	try {
		existing = fs.readFileSync(mdPath, "utf8")
	} catch {
		fs.mkdirSync(path.dirname(mdPath), { recursive: true })
		fs.writeFileSync(mdPath, block(body) + "\n")
		return "created"
	}
	const m = BEGIN_RE.exec(existing)
	const e = existing.indexOf(END)
	if (!m || e === -1 || e < m.index) {
		// No block yet — append ours, leaving everything the developer wrote untouched.
		fs.writeFileSync(mdPath, existing.trimEnd() + "\n\n" + block(body) + "\n")
		return "created"
	}
	const current = existing.slice(m.index + m[0].length, e).trim()
	if (current === body.trim()) {
		return "unchanged"
	}
	// The marker records the fingerprint of what we last wrote. If the block no longer matches it, a
	// human has edited inside our fence — leave their words alone and say so.
	const stamped = /fp=([0-9a-f]{12})/.exec(m[0])?.[1]
	if (stamped && stamped !== fingerprint(current)) {
		return "skipped-user-edited"
	}
	fs.writeFileSync(mdPath, existing.slice(0, m.index) + block(body) + existing.slice(e + END.length))
	return "updated"
}

/** Merge our server into a project `.mcp.json` without disturbing any other configured server. */
export function upsertMcpJson(mcpJsonPath: string, serverPath: string, nodeBin = "node"): "created" | "updated" | "unchanged" {
	let cfg: any = {}
	let existed = false
	try {
		cfg = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"))
		existed = true
	} catch {}
	if (!cfg || typeof cfg !== "object") {
		cfg = {}
	}
	if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") {
		cfg.mcpServers = {}
	}
	const desired = { command: nodeBin, args: [serverPath] }
	const cur = cfg.mcpServers.adsum
	if (cur && cur.command === desired.command && Array.isArray(cur.args) && cur.args[0] === serverPath) {
		return "unchanged"
	}
	cfg.mcpServers.adsum = desired
	fs.mkdirSync(path.dirname(mcpJsonPath), { recursive: true })
	fs.writeFileSync(mcpJsonPath, JSON.stringify(cfg, null, 2) + "\n")
	return existed ? "updated" : "created"
}
