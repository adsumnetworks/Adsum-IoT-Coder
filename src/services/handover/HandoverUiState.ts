/**
 * Handover UI state — the ONE contract the agent strip hangs off.
 *
 * Pure by design (fs reads only, no vscode, no git, no network): it turns the four on-disk files of a
 * handover into the compact shape the webview renders, and nothing else. That purity is what makes it
 * unit-testable and keeps it legal under the standalone-build boundary (no raw vscode.* in services/).
 *
 * THE HONESTY RULE THIS FILE ENFORCES: two witnesses, never merged. What the agent REPORTED (its
 * checkpoints) and what Adsum SAW (host-written observations: tree changes, snapshots, diffstat, and
 * the tool calls that came through us) stay distinct all the way to the pixel. Anything the host did
 * not itself observe must never render as "Adsum saw". Facts the host learns by running something —
 * a git diffstat, a snapshot commit — are WRITTEN by the host into observations.jsonl and only READ
 * here; this module never shells out.
 */
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { HandoverStrip, HandoverUiState, MilestoneRow } from "@shared/handover"

export type { HandoverStrip, HandoverUiState, MilestoneRow }

/** Newest-last; the builder keeps the last CAP rows (the full record stays in the worklog view). */
const MILESTONE_CAP = 30
/** A handover older than this never renders a strip — stale UI is worse than no UI. */
const STALE_AFTER_MS = 48 * 60 * 60 * 1000
/** No ledger activity for this long → drop the "live" pulse (claiming live when it isn't is a lie). */
const LIVE_WINDOW_MS = 90_000
/** Beyond this with no call, the agent is treated as STOPPED: we stop implying it will come back, and
 *  the composer stops offering to queue. Live evidence: two messages queued to an agent that had ended
 *  its session 5 minutes earlier were never delivered and were silently lost. */
const STOPPED_AFTER_MS = 15 * 60_000
/** How long a RETURNED session keeps rendering, so the resumed task can carry its turns as history. */
const RETURNED_WINDOW_MS = 12 * 60 * 60 * 1000

const readJson = (p: string, fallback: any = null) => {
	try {
		return JSON.parse(fs.readFileSync(p, "utf8"))
	} catch {
		return fallback
	}
}
const readJsonl = (p: string): any[] => {
	try {
		return fs
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
			.filter(Boolean)
	} catch {
		return []
	}
}

/**
 * The drift nudges the milestone list shows. DERIVED, never stored — the ledger records what happened
 * and this reads intent out of it, so a nudge can be re-tuned without a data migration.
 *
 * Two real drift signals, both taken from the live softAP evidence:
 *  1. the agent reports doing work in its own terminal (embedded commands belong in adsum's tools)
 *  2. the agent mutates source and reaches the next checkpoint without ever building — the exact
 *     failure that left the developer's project uncompilable with a missing include.
 */
function deriveNudges(events: any[]): MilestoneRow[] {
	const out: MilestoneRow[] = []
	const checkpoints = events.filter((e) => e.event === "checkpoint")
	for (const [i, cp] of checkpoints.entries()) {
		// Only TOOLCHAIN commands outside exec/build are drift. Reading files or grepping logs with its
		// own shell is legitimate — and we forced exactly that by truncating a failing build's real error
		// out of the tool output, then nudged the agent for the workaround our own tool required. A false
		// accusation in amber teaches the developer to distrust the signal, so this fires narrowly now.
		if (Array.isArray(cp.tools_used) && cp.tools_used.includes("own_terminal_toolchain")) {
			out.push({
				kind: "nudge",
				t: cp.t,
				text: "nudged: a toolchain command ran outside Adsum's tools — Adsum asked which one and why",
			})
		}
		// The CLOSING checkpoint lists the files touched across the whole session, not a fresh mutation, so
		// nudging it is a false positive — and it would fire exactly when the agent is done and can no
		// longer act on it. Only mid-session mutations get the build gate.
		if (!cp.final && Array.isArray(cp.files_touched) && cp.files_touched.length > 0) {
			// did a build run through us between this checkpoint and the next one?
			const next = checkpoints[i + 1]
			// A build that lands inside the same milestone (even before the next checkpoint is recorded)
			// counts — the earlier window was tight enough to fire on a session that DID build.
			const cpMs = Date.parse(cp.t) || 0
			const built = events.some(
				(e) =>
					e.event === "tool_build" &&
					((e.t > cp.t && (!next || e.t <= next.t)) || Math.abs((Date.parse(e.t) || 0) - cpMs) < 60_000),
			)
			if (!built) {
				out.push({
					kind: "nudge",
					t: cp.t,
					text: "nudged: edited source without building — Adsum asked it to run the build gate",
				})
			}
		}
	}
	return out
}

/** The newest handover that should own the strip, or null. */
function pickHandover(root: string, now: number): string | null {
	let dirs: { id: string; created: number; status?: string; returnedAt?: number }[] = []
	try {
		dirs = fs
			.readdirSync(root, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => {
				const st = readJson(path.join(root, e.name, "state.json"), {}) ?? {}
				return {
					id: e.name,
					created: Date.parse(st.createdAt ?? "") || 0,
					status: st.status,
					returnedAt: Date.parse(st.returnedAt ?? "") || 0,
				}
			})
			// "returned" is included on purpose: the resumed task renders the agent's turns as its own
			// history, so the session has to survive its own homecoming (bounded below).
			.filter((d) => ["pending", "active", "closed-by-agent", "returned"].includes(d.status))
			.sort((a, b) => b.created - a.created)
	} catch {
		return null
	}
	const newest = dirs[0]
	if (!newest || (newest.created && now - newest.created > STALE_AFTER_MS)) {
		return null
	}
	// A returned session keeps rendering only long enough to be the resumed task's visible history.
	if (newest.status === "returned" && newest.returnedAt && now - newest.returnedAt > RETURNED_WINDOW_MS) {
		return null
	}
	return newest.id
}

/**
 * Build the webview's handover view from disk.
 *
 * @param root      the handovers directory (injectable so tests never touch the real ~/.adsum)
 * @param conductor resolved host-side (it needs secrets access, which this pure module must not have)
 * @param now       injectable clock for deterministic tests
 */
export function buildHandoverUiState(
	root: string,
	conductor: { active: boolean; reason: string },
	now: number = Date.now(),
	agent?: { present: boolean; how?: string },
): HandoverUiState {
	const id = pickHandover(root, now)
	if (!id) {
		return { conductor, agent, strip: null }
	}
	const dir = path.join(root, id)
	const brief = readJson(path.join(dir, "brief.json"), {}) ?? {}
	const state = readJson(path.join(dir, "state.json"), {}) ?? {}
	const events = readJsonl(path.join(dir, "ledger.jsonl"))
	const observations = readJsonl(path.join(dir, "observations.jsonl"))

	// ── phase ────────────────────────────────────────────────────────────────
	const hasWork = events.some((e) => ["checkpoint", "tool_exec", "tool_build"].includes(e.event))
	const resumed = events.some((e) => e.event === "resume")
	const phase: HandoverStrip["phase"] =
		state.status === "closed-by-agent" || state.status === "returned"
			? "closed"
			: state.status === "pending"
				? "posted"
				: hasWork
					? "working"
					: resumed
						? "pickedUp"
						: "posted"

	// ── milestones: the two witnesses, interleaved by time but never conflated ──
	const rows: MilestoneRow[] = []
	for (const e of events) {
		if (e.event === "kbit_load") {
			rows.push({
				kind: "bit",
				t: e.t,
				title: e.title || e.id,
				author: e.author || "the Adsum authoring team",
				version: e.version,
			})
		} else if (e.event === "checkpoint") {
			rows.push({ kind: "step", t: e.t, step: e.step && e.step !== "off-plan" ? e.step : undefined, text: e.worklog })
		} else if (e.event === "tool_exec" || e.event === "tool_build") {
			rows.push({ kind: "tool", t: e.t, command: e.command ?? "", exit: e.exit ?? 0 })
		}
	}
	for (const o of observations) {
		if (o.event === "tree_change") {
			rows.push({ kind: "host", t: o.t, files: o.files ?? [] })
		} else if (o.event === "snapshot") {
			rows.push({ kind: "snap", t: o.t })
		}
	}
	// Developer→agent messages: still-queued ones live in messages.jsonl (the server deletes the file
	// when it delivers); delivered ones are ledger facts. Both render as "you" turns in the session.
	for (const m of readJsonl(path.join(dir, "messages.jsonl"))) {
		if (typeof m.text === "string") {
			rows.push({ kind: "msg", t: m.t, text: m.text, delivered: false })
		}
	}
	for (const e of events) {
		if (e.event === "dev_message" && typeof e.text === "string") {
			rows.push({ kind: "msg", t: e.t, text: e.text, delivered: true })
		}
	}
	rows.push(...deriveNudges(events))
	rows.sort((a, b) => String(a.t).localeCompare(String(b.t)))
	const truncated = rows.length > MILESTONE_CAP
	const milestones = truncated ? rows.slice(-MILESTONE_CAP) : rows

	// ── liveness: what we can honestly claim about the agent's presence ───────
	const last = events[events.length - 1]
	const lastAt = Date.parse(last?.t ?? "") || 0
	const sinceMs = lastAt ? now - lastAt : now - (Date.parse(state.createdAt ?? "") || now)
	const liveness: HandoverStrip["liveness"] = {
		state: !resumed
			? "never-picked-up"
			: phase === "closed"
				? "stopped"
				: sinceMs < LIVE_WINDOW_MS
					? "working"
					: sinceMs < STOPPED_AFTER_MS
						? "idle"
						: "stopped",
		sinceSec: Math.max(0, Math.round(sinceMs / 1000)),
	}

	// queued-but-undelivered developer messages, with their age (a 10-minute-old queue is a red flag)
	const queued = readJsonl(path.join(dir, "messages.jsonl"))
		.filter((m) => typeof m.text === "string")
		.map((m) => ({ text: m.text as string, ageSec: Math.max(0, Math.round((now - (Date.parse(m.t) || now)) / 1000)) }))
	let live: HandoverStrip["live"]
	if (liveness.state === "working" && lastAt) {
		const verb =
			last.event === "tool_build"
				? "building…"
				: last.event === "tool_exec"
					? "running a command…"
					: last.event === "kbit_load"
						? `reading ${last.title ?? "a knowledge bit"}…`
						: "agent is working…"
		live = { verb, sinceSec: Math.round((now - lastAt) / 1000) }
	}

	// ── closing receipt ───────────────────────────────────────────────────────
	const finalCp = [...events].reverse().find((e) => e.event === "checkpoint" && e.final)
	const snapshots = observations.filter((o) => o.event === "snapshot").length
	let closing: HandoverStrip["closing"]
	if (phase === "closed" && finalCp) {
		const bits = events.filter((e) => e.event === "kbit_load")
		const authors = [...new Set(bits.map((b) => b.author).filter(Boolean))] as string[]
		const builds = events.filter((e) => e.event === "tool_build")
		closing = {
			headline: finalCp.worklog ?? "",
			itSays: { files: finalCp.files_touched ?? [], nextStep: finalCp.next_step },
			adsumSaw: {
				// host-written only — never inferred from what the agent claimed
				diffstat: [...observations].reverse().find((o) => o.event === "diffstat")?.text,
				snapshots,
				buildsGreen: builds.length > 0 && builds.every((b) => b.exit === 0),
			},
			standingOn: {
				authors,
				steward: (brief.bits ?? []).find((b: any) => b.steward && b.attributed)?.steward,
				bits: new Set(bits.map((b) => b.id)).size,
			},
		}
	}

	const governingBit = (brief.bits ?? []).find((b: any) => b.id === brief.governing)
	return {
		conductor,
		agent,
		strip: {
			id,
			phase,
			returned: state.status === "returned",
			mission: brief.mission ?? "",
			calls: events.filter((e) => e.event !== "returned").length,
			startedAt: state.createdAt ?? brief.createdAt ?? "",
			closedAt: state.closedAt,
			pickupPrompt: `Check the Adsum inbox and pick up the session (${id}).`,
			baseline: { created: !!brief.baseline?.ref, snapshots },
			packed: {
				bits: (brief.bits ?? []).length,
				governing: governingBit
					? {
							title: governingBit.title ?? governingBit.id,
							author: governingBit.author ?? "the Adsum authoring team",
							version: governingBit.version,
						}
					: undefined,
			},
			milestones,
			truncated,
			liveness,
			queued: queued.length ? queued : undefined,
			live,
			closing,
		},
	}
}

// ── the host-agnostic accessor the controller uses ────────────────────────────
//
// The controller is bundled into the standalone core and must stay runtime-free of vscode, so it may
// NOT reach into hosts/vscode for this. Instead the cache lives here (pure) and the VS Code host sets
// it: the conductor verdict needs secrets access, which only a host has.

const DEFAULT_ROOT = path.join(os.homedir(), ".adsum", "handovers")
/** Honest default: "not conductor / not yet resolved" — never claim there is no model before looking. */
let conductorCache: { active: boolean; reason: string } = { active: false, reason: "not yet resolved" }
/** Whether an auto-configurable coding agent is present — host-resolved (detectClaudeCode). */
let agentCache: { present: boolean; how?: string } | undefined

/** Set by the host once it has resolved whether any inference is configured. */
export function setConductorMode(v: { active: boolean; reason: string }): void {
	conductorCache = v
}

/** Set by the host once it has detected (or not) a coding agent it can auto-configure. */
export function setAgentFacts(v: { present: boolean; how?: string }): void {
	agentCache = v
}

/** The handover view for the webview (ExtensionState.handoverUi). Safe to call any time. */
export function getHandoverUiState(root: string = DEFAULT_ROOT): HandoverUiState {
	try {
		return buildHandoverUiState(root, conductorCache, Date.now(), agentCache)
	} catch {
		return { conductor: conductorCache, agent: agentCache, strip: null }
	}
}

/** Stable hash of the UI state — the push gate (a quiet tracker tick must cost nothing). */
export function handoverUiFingerprint(s: HandoverUiState): string {
	// `live.sinceSec` ticks every second by design; excluding it keeps the gate from firing on the clock
	// alone while still catching a genuine verb change.
	const stable = JSON.stringify(s, (k, v) => (k === "sinceSec" ? undefined : v))
	return createHash("sha256").update(stable).digest("hex").slice(0, 16)
}
