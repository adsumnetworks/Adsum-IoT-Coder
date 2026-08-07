/**
 * Handover brief — the PURE half (no vscode, no I/O beyond the two file helpers), so it is directly
 * testable and reusable when a second agent lands (H5).
 *
 * The design rule that matters here: we hand over a BRIEF, never a transcript. A transcript would burn
 * the receiving agent's context on history it doesn't need and is agent-specific anyway; the brief is
 * small, model-agnostic, and the Adsum agent — which knows the session state — produces it for free.
 */
import * as fs from "node:fs"
import * as path from "node:path"

// The managed-block mechanics moved to @utils/managedBlock so project memory (.adsum/PROJECT.md) can
// share them instead of growing a second copy. Re-exported here so every existing importer — and this
// file's tests — keep working unchanged.
export { type BlockResult, fingerprint, MANAGED_END, managedBeginMarker, upsertManagedBlock } from "@utils/managedBlock"

// ── dependency closure + verb bridge (H2.0) ─────────────────────────────────────
//
// A workflow bit is a hub: it routes the agent to spokes (find-sample, configure, debug-loop). The
// corpus expresses that routing in PROSE, not `requires:` frontmatter — as the extension's own idiom:
//   **MANDATORY SKILL LOAD:** `read_file` → `platforms/esp/actions/find-sample.md`
// In the extension a `read_file` on a kbit path is intercepted and resolved to the bit; in a foreign
// agent it is not, so (a) the referenced bits must travel in the brief, and (b) the "read_file → path"
// instruction must be rewritten to the verb that actually works there: `load_skill`.

/** The kinds a bit path names — lets a platform-relative ref (`actions/x.md`) resolve to a full id. */
const BIT_KINDS = "actions|workflows|rules|references|knowledges|sdks|boards|protocols"
/** The platform an id belongs to, or "" for the CORE corpus (adsum/rules/…, adsum/references/…).
 *  Treating "rules" as a platform produced the phantom `adsum/rules/rules/next-step` in a live brief. */
const CORE_KINDS = new Set(["rules", "references", "knowledges", "agent", "core"])
const platformOf = (id: string) => {
	const first = id.replace(/^adsum\//, "").split("/")[0]
	return CORE_KINDS.has(first) ? "" : first
}
/** Prefix for a platform-relative ref: core bits resolve against the corpus root, not a platform. */
const relBase = (id: string) => {
	const p = platformOf(id)
	return p ? `platforms/${p}/` : ""
}

/** id from an iot-knowledge-relative path. Inlined copy of KnowledgeResolver.deriveIdFromRel — kept here
 *  so this pure module stays free of the resolver's transitive (vscode/HostProvider) import graph. */
const idFromRel = (rel: string): string =>
	`adsum/${rel
		.replace(/\\/g, "/")
		.replace(/^platforms\//, "")
		.replace(/\.md$/i, "")
		.toLowerCase()}`

/**
 * The bit ids a body references. Two forms, both real in the corpus:
 *   full     `platforms/esp/actions/find-sample.md`      → adsum/esp/actions/find-sample
 *   relative `actions/configure.md` (same platform)      → adsum/<sourcePlatform>/actions/configure
 * Bare `x.md` filenames are deliberately ignored — ambiguous, and always back-references to a form above.
 */
export function extractBitRefs(sourceId: string, body: string): string[] {
	const ids = new Set<string>()
	const base = relBase(sourceId)
	for (const m of body.matchAll(/platforms\/([\w/-]+\.md)/gi)) {
		ids.add(idFromRel(`platforms/${m[1]}`))
	}
	const rel = new RegExp(`(?:^|[^\\w/.])((?:${BIT_KINDS})/[\\w/-]+\\.md)`, "gi")
	for (const m of body.matchAll(rel)) {
		ids.add(idFromRel(`${base}${m[1]}`))
	}
	ids.delete(sourceId) // a bit naming itself (its own header) is not a dependency
	return [...ids]
}

/**
 * Rewrite the extension's kbit-path read idiom into the foreign agent's verb, so a bit body handed to
 * Claude Code instructs the tool that actually works there. Surgical: only the exact
 * `` `read_file` → `…/x.md` `` directive is touched; every other line of curated prose is left alone.
 */
export function bridgeLoadVerbs(sourceId: string, body: string): string {
	const base = relBase(sourceId)
	const idFor = (p: string) => (p.startsWith("platforms/") ? idFromRel(p) : idFromRel(`${base}${p}`))
	return body.replace(
		new RegExp(`\`?read_file\`?\\s*(?:→|->)\\s*\`?((?:platforms/|(?:${BIT_KINDS})/)[\\w/-]+\\.md)\`?`, "gi"),
		(_full, p: string) => `call \`load_skill("${idFor(p)}")\``,
	)
}

/**
 * Bit ids a `requires:` frontmatter block declares (bare ids, no `.md` — the form extractBitRefs cannot
 * see, which is exactly why the softAP closure was only right by coincidence). Handles both the YAML
 * list form and the inline `requires: [a, b]` form.
 */
export function extractRequires(yaml: string): string[] {
	const ids: string[] = []
	const inline = yaml.match(/^requires:\s*\[([^\]]*)\]/m)
	if (inline) {
		for (const p of inline[1].split(",")) {
			const id = p.trim().replace(/^["']|["']$/g, "")
			if (id) {
				ids.push(id)
			}
		}
		return ids
	}
	const block = yaml.match(/^requires:\s*\n((?:\s+-\s+.+\n?)+)/m)
	if (block) {
		for (const m of block[1].matchAll(/-\s+(.+)/g)) {
			const id = m[1].trim().replace(/^["']|["']$/g, "")
			if (id) {
				ids.push(id)
			}
		}
	}
	return ids
}

/**
 * A workflow's ordered step labels, parsed from its `## Step N: Title` headings (HD-H2 option a —
 * zero corpus change; the labels double as the checkpoint tool's `step` enum, so the AGENT classifies
 * its own progress and the server stays a state machine — no inference on our side, ever).
 */
export function parseWorkflowSteps(body: string): string[] {
	const steps: string[] = []
	let seq: { depth: number; total: string } | null = null
	// Workflows label their sequence as either "Step N" or "Phase N", at whatever heading depth the
	// author chose — debug-loop.md opens with `## Step 0` then runs `### Phase 1..5`. Matching only
	// "Step" saw 1 of 6, so the server told the agent it was finished before it had built anything,
	// and real Phase-1 work had to be reported as off-plan. Match both, in document order.
	for (const line of body.split("\n")) {
		// A heading at or above the sequence heading's depth closes its list section.
		const depth = line.match(/^(#{1,6})[ \t]/)
		if (depth && seq && depth[1].length <= seq.depth) {
			seq = null
		}
		const heading = line.match(HEADING_STEP_RE)
		if (heading) {
			const kind = heading[1][0].toUpperCase() + heading[1].slice(1).toLowerCase()
			// Titles are passed through untouched apart from a trailing parenthetical aside. Normalising
			// them further (e.g. cutting at an em dash) collapses "Post-Generation — RTT Check" and
			// "Post-Generation — BLE Stack Check" into ONE label, and the server resolves progress with
			// steps.indexOf() — so the agent reporting step 5 would be recorded as step 4.
			steps.push(`${kind} ${heading[2].replace(/[ \t]/g, "")}: ${heading[3].replace(/\(.*?\)\s*$/, "").trim()}`)
			continue
		}
		// cra-readiness writes its five phases as an ordered LIST under a heading that announces the
		// sequence ("## The five phases (emit the `### Step N/5` banner…)"), not as headings — which is
		// why the heading scan alone saw 1 of 7 and forced 6 of 7 checkpoints to report off-plan.
		const announce = line.match(SEQ_HEADING_RE)
		if (announce) {
			seq = { depth: announce[1].length, total: announce[2] }
			continue
		}
		const item = seq && line.match(LIST_STEP_RE)
		if (item && seq) {
			steps.push(`Step ${item[1]}/${seq.total}: ${item[2].replace(/\.\s*$/, "").trim()}`)
		}
	}
	return steps
}

/** `## Step 0.5 — …`, `### Step 3/5 · …`, `## Phase 2: …` — the number may be decimal and carry an `/M`. */
const HEADING_STEP_RE =
	/^#{2,4}[ \t]*(step|phase)[ \t]*(\d+(?:\.\d+)?[a-z]?(?:[ \t]*\/[ \t]*\d+)?)[ \t]*[:—–·-][ \t]*(.+?)[ \t]*$/i
/** A heading that announces its steps as an ordered list rather than as sub-headings (mentions `Step N/M`). */
const SEQ_HEADING_RE = /^(#{2,4})[ \t]+.*?\b(?:step|phase)s?[ \t]*[n\d][ \t]*\/[ \t]*(\d+)/i
/** A top-level ordered-list item with a bold title, inside a sequence-announcing section. */
const LIST_STEP_RE = /^(\d+)\.[ \t]+\*\*(.+?)\*\*/

/** A platform-scoped id's core-corpus fallback (`adsum/esp/rules/next-step` → `adsum/rules/next-step`).
 *  The corpus keeps cross-platform rules at the root; a platform-relative prose ref to one of them
 *  resolves wrongly platform-scoped first — this is the second place to look before calling it missing. */
export function coreFallbackId(id: string): string | null {
	const m = id.match(/^adsum\/[^/]+\/(rules|references|knowledges)\/(.+)$/)
	return m ? `adsum/${m[1]}/${m[2]}` : null
}

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
	// The opening prompt IS the mission — unless it is our own reverse-handoff boilerplate ("Continue
	// this task — it was handed to my coding agent…"), which happens whenever a returned session is
	// handed over again. Ingesting that verbatim degrades the mission one generation per round trip
	// (seen live: the strip read "· Continue this task — it was handed to…"). The boilerplate carries
	// the real mission on its "Original mission:" line — recover it instead.
	const opening = texts[0]?.text?.trim() ?? ""
	const mission = opening.startsWith("Continue this task — it was handed to my coding agent")
		? (opening.match(/^Original mission:\s*(.+)$/m)?.[1]?.trim() ?? opening)
		: opening
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

/** The instructions we ask the receiving agent to follow. Written for a LITERAL reader: every glyph and
 *  tool name here must match what the server actually emits (the 📚-vs-◆ drift was a real defect). */
export function managedBlockBody(handoverId: string): string {
	return [
		"## Adsum embedded workflow (this project)",
		"",
		`This project has an active Adsum IoT Coder handover (\`${handoverId}\`). The \`adsum\` MCP server carries the mission and the curated, hardware-verified knowledge for it.`,
		"",
		`- **Check the inbox.** At the start of a session here — and whenever the developer says "check the Adsum inbox" — call \`adsum.inbox\`. The developer posts handed-over sessions there from the extension.`,
		`- **To pick one up, call \`adsum.resume_handover\`** — it returns the mission, the governing workflow with its steps, what has already been done, and the knowledge bits available.`,
		"- **Before acting on any nRF / ESP / embedded task, call `adsum.load_skill`** with the topic (e.g. `flash`, `sniffer`, the bit id). These bits are verified on real hardware and supersede general knowledge — follow their steps rather than improvising.",
		"- **Run embedded commands through `adsum.exec` / `adsum.build`** (idf.py, esptool, west, serial-port checks). They carry the toolchain environment a plain shell does not have; a bare `idf.py` in your own terminal will typically fail with *command not found*. Never install or repair a toolchain yourself — if the environment is broken, `adsum.exec` says what is missing; report it to the developer and ask.",
		"- **Surface the credit line.** Every loaded bit starts with `◆ <bit> — curated by <author>` (`⚙` for tool bits). Show it once, the first time you use that bit, so the author is credited to the developer.",
		"- **Call `adsum.checkpoint` at every milestone AND after any file mutation** (create/edit/delete). Answer what its response asks — which step you completed, which bit you followed, which tools you used. The developer watches the session through these; an unreported mutation is invisible to them.",
		"- **Before you stop working, send a closing checkpoint** with `final: true`, a summary, the files you touched, and the honest next step — that is what makes the session resumable back in Adsum without loss.",
	].join("\n")
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
