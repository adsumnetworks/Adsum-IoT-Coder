import type { Defect, EnvJson, Freshness, SessionJson, StatusJson } from "./schema"

/**
 * Pure renderers for workspace project memory — ZERO I/O.
 *
 * Everything here is a total function of its arguments: no fs, no HostProvider, no clock, no
 * randomness, no locale. That is deliberate and load-bearing:
 *
 *   1. PROJECT.md is injected into the SYSTEM PROMPT, which is the provider's cached prefix.
 *      A render that is not byte-stable for unchanged input invalidates that cache and forces
 *      a re-process of the whole prefix on every turn. Determinism here is a cost control, not
 *      a style preference. The tests assert byte-stability directly.
 *   2. Rendering is the only place where memory can grow without bound, so the caps live here
 *      with the renderer rather than in the caller, where they would be easy to forget.
 *
 * Rules for anyone editing this file:
 *   - Never call Date.now(), Math.random(), toLocaleString(), or localeCompare().
 *   - Never iterate an object's keys without sorting them first (V8 key order is an
 *     implementation detail for anything but integer-like keys).
 *   - Never truncate mid-word. Use clampWordSafe().
 *
 * All caps are counted in JavaScript chars (UTF-16 code units). The status glyphs used below
 * are BMP, so one glyph is one char.
 */

// ── caps ─────────────────────────────────────────────────────────────────────────

/** Hard cap for the whole of PROJECT.md. It rides in every system prompt for this workspace. */
export const PROJECT_MD_CAP = 4096

/** Hard cap for the volatile tail block appended to the last user message each turn. */
export const TAIL_BLOCK_CAP = 1600

/** How many loop events the tail block shows before it starts dropping the oldest. */
export const TAIL_LOOP_EVENTS = 5

export const TAIL_BEGIN = "=== ADSUM PROJECT STATE (auto-generated, do not edit) ==="
export const TAIL_END = "=== END ADSUM PROJECT STATE ==="

// ── input types ──────────────────────────────────────────────────────────────────

/** One buildable application in the workspace. Already resolved by the caller — no detector objects. */
export interface AppEntry {
	/** Directory name or app name, e.g. "gateway". */
	name: string
	/** "nrf" | "esp" | anything the classifier produced. */
	platform: string
	/** Board or target: "nrf52840dk/nrf52840", "esp32s3". */
	target?: string
	/** "rtt" | "uart" | "usb-cdc" — how logs come off this app. */
	transport?: string
	/** Build directory, relative to the workspace or absolute. */
	buildDir?: string
}

/** A device on THIS bench, already merged from devices.json + a live probe. */
export interface DeviceEntry {
	/** J-Link serial or VID:PID+serial. */
	id: string
	description?: string
	board?: string
	family?: string
	port?: string
	/** Rendered through renderFreshness() so every surface uses one vocabulary. */
	freshness: Freshness
}

/** One `.adsum/notes/*.md` topic file. */
export interface NoteEntry {
	/** ABSOLUTE path. The model cannot derive it, so it must be spelled out or the note is unreachable. */
	path: string
	/** File name or human title shown in the index. */
	title: string
	/** One line. This is the only thing the model sees before deciding to read the file. */
	summary: string
	/** ISO-8601. Used ONLY for the deterministic drop order (oldest dropped first) and sort. */
	updatedAt?: string
}

export interface ProjectMdInput {
	/** The goal one-liner. Owned by model/human. */
	goal?: string
	apps?: AppEntry[]
	devices?: DeviceEntry[]
	/** Bench facts the host cannot detect: jumpers, switch positions, modes. Model-written, in the model's order. */
	assertedHardware?: string[]
	env?: EnvJson
	notesIndex?: NoteEntry[]
	/** Pre-rendered workspace map body, injected conditionally by the caller. */
	mapSection?: string
	/**
	 * Absolute path of the `.adsum` directory, used only to tell the reader where the full record
	 * lives when a section had to be dropped. Falls back to the relative form.
	 */
	adsumDir?: string
}

// ── section fences ───────────────────────────────────────────────────────────────

/**
 * Sections are wrapped in HTML comment fences so host code can upsert exactly one section with a
 * regex replace and leave the model-owned prose either side untouched. The predecessor wrote the
 * whole file with writeFile(), which meant every host write raced (and silently clobbered) every
 * model write. The `owner=` attribute makes that ownership physical and greppable.
 */
export const SECTION_OWNERS = {
	goal: "model,human",
	apps: "host",
	hardware: "host",
	"hardware-asserted": "model",
	toolchain: "host",
	notes: "model",
	map: "host",
} as const

export type SectionId = keyof typeof SECTION_OWNERS

function fence(id: SectionId, body: string): string {
	return `<!-- adsum:${id} owner=${SECTION_OWNERS[id]} -->\n${body}\n<!-- /adsum:${id} -->`
}

/** Matches one whole fenced section, attributes and all. For host-side upsert. */
export function sectionFenceRegex(id: string): RegExp {
	const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	return new RegExp(`<!--\\s*adsum:${esc}(?:\\s[^>]*?)?-->[\\s\\S]*?<!--\\s*/adsum:${esc}\\s*-->`)
}

// ── small deterministic helpers ──────────────────────────────────────────────────

/** Code-unit comparison. localeCompare() is locale-dependent and therefore banned here. */
function byStr(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0
}

/** Truncate on a word boundary, never mid-word. The result is always <= max chars. */
export function clampWordSafe(text: string, max: number): string {
	if (text.length <= max) {
		return text
	}
	const ellipsis = " …"
	const room = Math.max(0, max - ellipsis.length)
	let cut = text.slice(0, room)
	const lastBreak = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"))
	if (lastBreak > 0) {
		cut = cut.slice(0, lastBreak)
	}
	return `${cut.trimEnd()}${ellipsis}`
}

/** Join the present parts of a bullet with an em dash, skipping blanks. */
function dashJoin(parts: Array<string | undefined>): string {
	return parts.filter((p): p is string => !!p && p.length > 0).join(" — ")
}

/** Collapse to a single line — a stray newline inside a table cell breaks the table. */
function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim()
}

/** Markdown table cells: `|` would terminate the cell. */
function cell(text: string | undefined): string {
	return oneLine(text ?? "").replace(/\|/g, "\\|") || "—"
}

// ── freshness — the shared vocabulary ────────────────────────────────────────────

/**
 * ONE vocabulary for "do I still believe this?", used by every surface that shows detected
 * state. Three words only, so the model never has to interpret a bespoke phrasing:
 *
 *   ✓ fresh   — verified at a specific time; act on it
 *   ⚠ stale   — was true, something changed; the command to re-verify is in the string itself
 *   ✗ unknown — never detected; do NOT invent a value
 *
 * A malformed/absent Freshness degrades to "unknown". Memory must never be able to throw.
 */
export function renderFreshness(f: Freshness): string {
	if (!f || typeof (f as { kind?: unknown }).kind !== "string") {
		return "✗ unknown — never detected"
	}
	switch (f.kind) {
		case "fresh":
			return `✓ fresh (verified ${f.verifiedAt})`
		case "stale":
			return f.reverifyWith ? `⚠ stale — ${f.reason} — re-verify with: ${f.reverifyWith}` : `⚠ stale — ${f.reason}`
		default:
			return "✗ unknown — never detected"
	}
}

// ── PROJECT.md ───────────────────────────────────────────────────────────────────

/** How much of each section survives at a given trim level. */
interface TrimLevel {
	asserted: boolean
	notesKept: number
	toolchainDetail: boolean
	appsFull: boolean
	map: boolean
}

const FULL_LEVEL = (notes: number): TrimLevel => ({
	asserted: true,
	notesKept: notes,
	toolchainDetail: true,
	appsFull: true,
	map: true,
})

function renderGoal(goal: string | undefined): string {
	const body = goal && goal.trim() ? oneLine(goal) : "_No goal recorded yet. Ask the developer, then record it._"
	return fence("goal", `## Goal\n\n${body}`)
}

function renderApps(apps: AppEntry[], full: boolean): string {
	if (apps.length === 0) {
		return fence("apps", "## Apps\n\n_No apps detected._")
	}
	const head = full
		? "| app | platform | board/target | transport | build dir |\n| --- | --- | --- | --- | --- |"
		: "| app | platform | board/target |\n| --- | --- | --- |"
	const rows = apps.map((a) =>
		full
			? `| ${cell(a.name)} | ${cell(a.platform)} | ${cell(a.target)} | ${cell(a.transport)} | ${cell(a.buildDir)} |`
			: `| ${cell(a.name)} | ${cell(a.platform)} | ${cell(a.target)} |`,
	)
	return fence("apps", `## Apps\n\n${head}\n${rows.join("\n")}`)
}

function renderHardware(devices: DeviceEntry[]): string {
	if (devices.length === 0) {
		return fence("hardware", "## Hardware\n\n_No devices detected on this bench yet._")
	}
	const bullets = devices.map((d) =>
		dashJoin([
			`- \`${oneLine(d.id)}\``,
			d.description ? oneLine(d.description) : undefined,
			d.board ? `board ${oneLine(d.board)}` : undefined,
			d.family ? `family ${oneLine(d.family)}` : undefined,
			d.port ? `port ${oneLine(d.port)}` : undefined,
			renderFreshness(d.freshness),
		]),
	)
	return fence("hardware", `## Hardware\n\n${bullets.join("\n")}`)
}

function renderAsserted(asserted: string[], keep: boolean): string {
	const heading = "## Hardware — asserted by developer"
	if (!keep) {
		// Fence kept even when empty so host-side upsert still has an anchor to write into.
		return fence("hardware-asserted", heading)
	}
	const note = "_Bench facts the host cannot detect (jumpers, switch positions, modes)._"
	if (asserted.length === 0) {
		return fence("hardware-asserted", `${heading}\n\n${note}`)
	}
	// Input order is preserved: these are the developer's own words and their order carries meaning.
	const bullets = asserted.map((a) => `- ${oneLine(a)}`).join("\n")
	return fence("hardware-asserted", `${heading}\n\n${note}\n${bullets}`)
}

function renderToolchain(env: EnvJson | undefined, detail: boolean): string {
	const lines: string[] = []
	const ncsInstalled = [...(env?.ncsVersions ?? [])].sort(byStr)
	if (env?.ncsProjectVersion || ncsInstalled.length > 0) {
		if (detail) {
			lines.push(
				dashJoin([
					"- nRF Connect SDK",
					env?.ncsProjectVersion ? `project pins ${env.ncsProjectVersion}` : undefined,
					ncsInstalled.length > 0 ? `installed: ${ncsInstalled.join(", ")}` : undefined,
				]),
			)
			const roots = env?.ncsRoots ?? {}
			const rootKeys = Object.keys(roots).sort(byStr)
			if (rootKeys.length > 0) {
				lines.push(`- NCS roots: ${rootKeys.map((k) => `${k} → ${roots[k]}`).join("; ")}`)
			}
		} else {
			lines.push(`- nRF Connect SDK ${env?.ncsProjectVersion ?? ncsInstalled[ncsInstalled.length - 1] ?? "?"}`)
		}
	}
	if (env?.idfProjectVersion || env?.idfVersion) {
		if (detail) {
			lines.push(
				dashJoin([
					"- ESP-IDF",
					env?.idfProjectVersion ? `project pins ${env.idfProjectVersion}` : undefined,
					env?.idfVersion ? `installed: ${env.idfVersion}` : undefined,
					env?.idfPath ? `IDF_PATH ${env.idfPath}` : undefined,
				]),
			)
		} else {
			lines.push(`- ESP-IDF ${env?.idfProjectVersion ?? env?.idfVersion}`)
		}
	}
	if (detail && env?.pythonVersion) {
		lines.push(`- Python ${env.pythonVersion}`)
	}
	const body = lines.length > 0 ? lines.join("\n") : "_Toolchain not detected yet._"
	return fence("toolchain", `## Toolchain\n\n${body}`)
}

function renderNotes(notes: NoteEntry[], kept: number): string {
	const heading = "## Notes"
	const shown = notes.slice(0, Math.max(0, kept))
	if (shown.length === 0) {
		return fence("notes", `${heading}\n\n_No topic notes yet._`)
	}
	const lead = "Topic files — not injected. `read_file` one before working in its area."
	const bullets = shown.map((n) => `- ${oneLine(n.title)} — ${oneLine(n.summary)} — ${n.path}`).join("\n")
	return fence("notes", `${heading}\n\n${lead}\n${bullets}`)
}

function assemble(input: ProjectMdInput, apps: AppEntry[], devices: DeviceEntry[], notes: NoteEntry[], lvl: TrimLevel): string {
	const parts = [
		"<!-- adsum:project schema=1 -->",
		// HARD REQUIREMENT: no timestamp anywhere in this header (or anywhere else in this file).
		// PROJECT.md is injected into the cached system prompt; a per-render timestamp would change
		// the prefix on every turn and force the provider to re-process the whole prompt. If you
		// need "when was this generated", read the mtime of the file — do not render it.
		"<!-- No timestamp in this file by design: it is injected into the cached system prompt, so a per-render timestamp would invalidate that cache every turn. -->",
		renderGoal(input.goal),
		renderApps(apps, lvl.appsFull),
		renderHardware(devices),
		renderAsserted(input.assertedHardware ?? [], lvl.asserted),
		renderToolchain(input.env, lvl.toolchainDetail),
		renderNotes(notes, lvl.notesKept),
	]
	if (lvl.map && input.mapSection && input.mapSection.trim()) {
		parts.push(fence("map", `## Workspace map\n\n${input.mapSection.trim()}`))
	}
	return parts.join("\n\n")
}

/** Single line naming what was dropped and where the full record lives. Never more than one. */
function dropNotice(dropped: string[], adsumDir: string): string {
	return `> Trimmed to fit the ${PROJECT_MD_CAP}-char cap — dropped: ${dropped.join(", ")}. Full record in ${adsumDir}.`
}

/**
 * If a last-resort clamp cut inside a fenced section, close it so host-side upsert regexes still
 * match. Well-formed output matters more than the last twenty characters of prose.
 */
function closeDanglingFence(text: string): string {
	const opens = [...text.matchAll(/<!--\s*adsum:([a-z-]+)(?:\s[^>]*?)?-->/g)]
	const last = opens[opens.length - 1]
	if (!last) {
		return text
	}
	const id = last[1]
	if (id === "project") {
		return text
	}
	const after = text.slice(last.index ?? 0)
	if (new RegExp(`<!--\\s*/adsum:${id}\\s*-->`).test(after)) {
		return text
	}
	return `${text}\n<!-- /adsum:${id} -->`
}

/**
 * Render the always-injected PROJECT.md.
 *
 * Deterministic in every respect: apps sort by name, devices by id, notes by recency then path,
 * toolchain version lists and root maps by key. Only `assertedHardware` keeps its input order,
 * because those are the developer's sentences and reordering them changes their meaning.
 *
 * OVER THE CAP, sections are dropped in this fixed order (documented so the model can predict
 * what it will lose, and so the tests can assert it):
 *   1. asserted-hardware detail
 *   2. notes index entries, oldest first
 *   3. toolchain detail
 *   4. apps table extra columns (transport, build dir)
 *   5. the workspace map body — a last resort past the four documented stages
 *   6. word-safe clamp of the whole document (pathological input only; never mid-word)
 * Each pass appends exactly ONE line naming what went and where to read it in full.
 */
export function renderProjectMd(input: ProjectMdInput): string {
	const inp = input ?? {}
	const adsumDir = inp.adsumDir?.trim() || ".adsum"

	const apps = [...(inp.apps ?? [])].sort((a, b) => byStr(a.name, b.name) || byStr(a.platform, b.platform))
	const devices = [...(inp.devices ?? [])].sort((a, b) => byStr(a.id, b.id))
	// Newest first, so "drop the oldest" is simply "drop from the end".
	const notes = [...(inp.notesIndex ?? [])].sort((a, b) => byStr(b.updatedAt ?? "", a.updatedAt ?? "") || byStr(a.path, b.path))

	// The ladder of successively smaller renders, in the documented drop order.
	const steps: Array<{ level: TrimLevel; dropped: string[] }> = []
	const full = FULL_LEVEL(notes.length)
	steps.push({ level: full, dropped: [] })

	let level: TrimLevel = { ...full, asserted: false }
	const dropped: string[] = ["asserted-hardware detail"]
	steps.push({ level, dropped: [...dropped] })

	for (let keep = notes.length - 1; keep >= 0; keep--) {
		const gone = notes.length - keep
		level = { ...level, notesKept: keep }
		steps.push({ level, dropped: [...dropped, `${gone} notes index ${gone === 1 ? "entry" : "entries"}`] })
	}
	if (notes.length > 0) {
		dropped.push(`${notes.length} notes index ${notes.length === 1 ? "entry" : "entries"}`)
	}

	level = { ...level, notesKept: 0, toolchainDetail: false }
	dropped.push("toolchain detail")
	steps.push({ level, dropped: [...dropped] })

	level = { ...level, appsFull: false }
	dropped.push("apps table extra columns")
	steps.push({ level, dropped: [...dropped] })

	if (inp.mapSection && inp.mapSection.trim()) {
		level = { ...level, map: false }
		dropped.push("workspace map")
		steps.push({ level, dropped: [...dropped] })
	}

	for (const step of steps) {
		const body = assemble(inp, apps, devices, notes, step.level)
		const candidate = step.dropped.length === 0 ? body : `${body}\n\n${dropNotice(step.dropped, adsumDir)}`
		if (candidate.length <= PROJECT_MD_CAP) {
			return candidate
		}
	}

	// Pathological input (a goal or a device list that alone exceeds the cap). Clamp on a word
	// boundary, leave room for the notice and a closing fence, and never emit a broken document.
	const last = steps[steps.length - 1]
	const notice = dropNotice([...last.dropped, "overflow text"], adsumDir)
	const reserve = notice.length + 40
	const clamped = closeDanglingFence(clampWordSafe(assemble(inp, apps, devices, notes, last.level), PROJECT_MD_CAP - reserve))
	return `${clamped}\n\n${notice}`
}

// ── the volatile tail block ──────────────────────────────────────────────────────

/** Open and under-test only, open first, then by id. Closed defects are noise the model re-litigates. */
function liveDefects(status: StatusJson): Defect[] {
	const rank = (d: Defect): number => (d.state === "open" ? 0 : 1)
	return (status?.defects ?? [])
		.filter((d) => d.state !== "closed")
		.slice()
		.sort((a, b) => rank(a) - rank(b) || byStr(a.id, b.id))
}

interface TailLevel {
	loopKept: number
	evidence: boolean
	defectsKept: number
}

function assembleTail(status: StatusJson, session: SessionJson, lvl: TailLevel): string {
	const lines: string[] = [TAIL_BEGIN]

	// Goal recitation. This is the whole point of the tail block: a goal stated once, 40K tokens
	// back in the transcript, is a goal the model has effectively lost. Restating it adjacent to
	// the newest user turn is the cheapest known fix for "lost in the middle".
	const goal = status?.goal?.text?.trim()
	lines.push(`Goal: ${goal ? oneLine(goal) : "(none recorded — ask the developer, then record it)"}`)

	const focus = session?.focus?.trim()
	if (focus) {
		lines.push(`Focus: ${oneLine(focus)}`)
	}

	const defects = liveDefects(status).slice(0, lvl.defectsKept)
	const totalLive = liveDefects(status).length
	if (totalLive > 0) {
		lines.push(`Open defects (${totalLive}):`)
		for (const d of defects) {
			lines.push(`- ${d.id} [${d.state}] ${oneLine(d.title)}`)
			if (d.nextStep) {
				lines.push(`  next: ${oneLine(d.nextStep)}`)
			}
			if (lvl.evidence && d.evidence.length > 0) {
				lines.push(`  evidence: ${d.evidence.map(oneLine).join("; ")}`)
			}
		}
		if (defects.length < totalLive) {
			lines.push(`  (+${totalLive - defects.length} more in .adsum/status.json)`)
		}
	}

	const err = session?.lastError
	if (err?.text) {
		lines.push(dashJoin([`Last error: ${err.at || "(no timestamp)"}`, err.source, oneLine(err.text)]))
	}

	const loop = (session?.loop ?? []).slice(-Math.max(0, lvl.loopKept))
	if (loop.length > 0) {
		lines.push("Recent loop:")
		for (const e of loop) {
			const ok = e.ok === undefined ? "" : e.ok ? " ok" : " FAIL"
			lines.push(`- ${e.at} ${e.kind}${ok} — ${oneLine(e.detail)}`)
		}
	}

	lines.push(TAIL_END)
	return lines.join("\n")
}

/**
 * Render the volatile state block appended to the LAST USER MESSAGE each turn.
 *
 * It never goes in the system prompt. Everything here changes turn to turn — defects move,
 * the loop advances — and rewriting the cached prefix to carry that would cost far more than
 * the few hundred tokens it saves. On the last user message, mutation is free.
 *
 * Over the 1600-char cap it sheds in this order: loop events (oldest first), then evidence
 * paths, then defects past the first few, then a word-safe clamp. The goal line is the last
 * thing to go, because it is the reason the block exists.
 */
export function renderTailBlock(status: StatusJson, session: SessionJson): string {
	const st = status ?? { schema: 1 as const, defects: [] }
	const se = session ?? { schema: 1 as const, loop: [] }

	// Nothing worth saying ⇒ say nothing. A project with no memory yet must pay ZERO tokens per
	// turn; emitting an empty banner would be pure noise on every request forever.
	const hasOpenDefect = st.defects.some((d) => d.state !== "closed")
	if (!st.goal?.text && !hasOpenDefect && !se.focus && !se.lastError && se.loop.length === 0) {
		return ""
	}

	const levels: TailLevel[] = []
	for (let loopKept = TAIL_LOOP_EVENTS; loopKept >= 0; loopKept--) {
		levels.push({ loopKept, evidence: true, defectsKept: Number.MAX_SAFE_INTEGER })
	}
	levels.push({ loopKept: 0, evidence: false, defectsKept: Number.MAX_SAFE_INTEGER })
	for (const defectsKept of [6, 4, 2, 1]) {
		levels.push({ loopKept: 0, evidence: false, defectsKept })
	}

	for (const lvl of levels) {
		const out = assembleTail(st, se, lvl)
		if (out.length <= TAIL_BLOCK_CAP) {
			return out
		}
	}

	const minimal = assembleTail(st, se, { loopKept: 0, evidence: false, defectsKept: 1 })
	const footer = `\n${TAIL_END}`
	const body = minimal.slice(0, minimal.length - footer.length)
	return `${clampWordSafe(body, TAIL_BLOCK_CAP - footer.length)}${footer}`
}
