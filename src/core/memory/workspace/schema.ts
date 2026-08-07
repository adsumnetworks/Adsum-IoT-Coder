/**
 * Project-memory schema.
 *
 * Two rules govern every type here, both learned from measured failures:
 *
 * 1. OWNERSHIP IS PHYSICAL, NOT CONVENTIONAL. Each section is owned either by host code
 *    (deterministic, from detectors) or by the model. They never share a file the other
 *    rewrites wholesale, because the old handler did `writeFile(path, content)` — a full
 *    clobber that would race every host write.
 *
 * 2. STABLE THINGS AND VOLATILE THINGS LIVE IN DIFFERENT TIERS. Anything injected into the
 *    system prompt must change ONLY when the workspace itself changes, because the system
 *    prompt is the cached prefix: rewriting it mid-task forces the provider to re-process
 *    ~46K tokens. Volatile state (defects, current focus) is rendered into a tail block on
 *    the last user message instead, where mutation is free.
 */

/** Who may write a section. Enforced in the handler, not by convention. */
export type SectionOwner = "host" | "model" | "human"

export type Freshness =
	| { kind: "fresh"; verifiedAt: string }
	| { kind: "stale"; reason: string; reverifyWith?: string }
	| { kind: "unknown" }

// ── status.json — goals + defect ledger (committed, tail-rendered) ────────────────

export type DefectState = "open" | "under-test" | "closed"

export interface Defect {
	id: string
	title: string
	state: DefectState
	/**
	 * Where the claim comes from: "src/gw_uart.c:214" or "logs/rtt/cap_1012.log:2211-2247".
	 * At least one entry is REQUIRED on every write. The founder's rule — keep the log PATH and
	 * LINE RANGE, never the log body — is enforced by schema here rather than left to hope.
	 */
	evidence: string[]
	/** What has already been tried and ruled out, so the agent stops re-trying it. */
	attempted?: string[]
	nextStep?: string
	/**
	 * Host-stamped ONLY. The model may move a defect to "under-test" but may never declare it
	 * verified: firmware that compiles is not firmware that works. The host sets this after it
	 * observes a build -> flash -> capture sequence following the last edit to a file in evidence[].
	 */
	verified?: boolean
	verifiedBy?: string
	updatedAt: string
}

export interface StatusJson {
	schema: 1
	/** The project goal — survives every compaction. Append-only; current goal first. */
	goal?: { text: string; setAt: string; setBy: SectionOwner }
	priorGoals?: Array<{ text: string; setAt: string }>
	defects: Defect[]
}

// ── local/devices.json — this bench only (gitignored) ────────────────────────────

export interface KnownDevice {
	/** Stable identity: J-Link serial, or USB VID:PID+serial for a UART bridge. */
	id: string
	kind: "jlink" | "usb-serial" | "other"
	description?: string
	board?: string
	family?: string
	port?: string
	/**
	 * The developer's own words about how this board is currently set up — "DK in
	 * standalone mode, SW6 -> nRF only", "P0.13 jumpered to the ESP RX". Model-writable
	 * (the user has to tell it), never host-overwritten.
	 */
	mode?: string
	lastSeenAt?: string
	lastFlashedAt?: string
}

export interface DevicesJson {
	schema: 1
	devices: KnownDevice[]
	probedAt?: string
}

// ── local/env.json — toolchain on this machine (gitignored) ──────────────────────

export interface EnvJson {
	schema: 1
	ncsVersions?: string[]
	ncsProjectVersion?: string
	ncsRoots?: Record<string, string>
	idfVersion?: string
	idfProjectVersion?: string
	idfPath?: string
	pythonVersion?: string
	detectedAt?: string
}

// ── local/session.json — volatile working state (gitignored, tail-rendered) ──────

export interface LoopEvent {
	at: string
	kind: "build" | "flash" | "capture" | "analyze" | "edit" | "error"
	detail: string
	ok?: boolean
}

export interface SessionJson {
	schema: 1
	/** What the agent is doing right now, one line. Recited near the end of context. */
	focus?: string
	/** Rolling window of the debug loop — capped; oldest dropped first. */
	loop: LoopEvent[]
	lastError?: { at: string; text: string; source?: string }
	/**
	 * Decides at the NEXT task's start whether to inject the workspace map. Written at task end
	 * so the decision is made once per task — flipping it mid-task would rewrite the cached
	 * system prompt, which costs far more than the map saves.
	 */
	explorationProfile?: { turns: number; explorationCalls: number; recordedAt: string }
	updatedAt?: string
}

// ── defaults ─────────────────────────────────────────────────────────────────────

export const emptyStatus = (): StatusJson => ({ schema: 1, defects: [] })
export const emptyDevices = (): DevicesJson => ({ schema: 1, devices: [] })
export const emptyEnv = (): EnvJson => ({ schema: 1 })
export const emptySession = (): SessionJson => ({ schema: 1, loop: [] })

// ── validators (hand-written; no new dependencies) ───────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const strArr = (v: unknown): string[] | undefined =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined

/**
 * Parse defensively: a hand-edited or half-written memory file must degrade to "empty",
 * never throw. Memory is an enhancement — it must never be able to break a task.
 */
export function parseStatus(raw: string): StatusJson {
	try {
		const j = JSON.parse(raw)
		if (!isObj(j)) {
			return emptyStatus()
		}
		const defects: Defect[] = Array.isArray(j.defects)
			? j.defects.filter(isObj).map((d) => ({
					id: str(d.id) ?? "unknown",
					title: str(d.title) ?? "(untitled)",
					state: (["open", "under-test", "closed"] as const).includes(d.state as DefectState)
						? (d.state as DefectState)
						: "open",
					evidence: strArr(d.evidence) ?? [],
					attempted: strArr(d.attempted),
					nextStep: str(d.nextStep),
					verified: typeof d.verified === "boolean" ? d.verified : undefined,
					verifiedBy: str(d.verifiedBy),
					updatedAt: str(d.updatedAt) ?? "",
				}))
			: []
		const goalObj = isObj(j.goal) ? j.goal : undefined
		return {
			schema: 1,
			goal: goalObj?.text
				? {
						text: String(goalObj.text),
						setAt: str(goalObj.setAt) ?? "",
						setBy: (str(goalObj.setBy) as SectionOwner) ?? "model",
					}
				: undefined,
			priorGoals: Array.isArray(j.priorGoals)
				? j.priorGoals.filter(isObj).map((g) => ({ text: String(g.text ?? ""), setAt: str(g.setAt) ?? "" }))
				: undefined,
			defects,
		}
	} catch {
		return emptyStatus()
	}
}

export function parseSession(raw: string): SessionJson {
	try {
		const j = JSON.parse(raw)
		if (!isObj(j)) {
			return emptySession()
		}
		return {
			schema: 1,
			focus: str(j.focus),
			loop: Array.isArray(j.loop)
				? j.loop.filter(isObj).map((e) => ({
						at: str(e.at) ?? "",
						kind: (str(e.kind) as LoopEvent["kind"]) ?? "analyze",
						detail: str(e.detail) ?? "",
						ok: typeof e.ok === "boolean" ? e.ok : undefined,
					}))
				: [],
			lastError: isObj(j.lastError)
				? { at: str(j.lastError.at) ?? "", text: str(j.lastError.text) ?? "", source: str(j.lastError.source) }
				: undefined,
			explorationProfile: isObj(j.explorationProfile)
				? {
						turns: Number(j.explorationProfile.turns) || 0,
						explorationCalls: Number(j.explorationProfile.explorationCalls) || 0,
						recordedAt: str(j.explorationProfile.recordedAt) ?? "",
					}
				: undefined,
			updatedAt: str(j.updatedAt),
		}
	} catch {
		return emptySession()
	}
}

export function parseDevices(raw: string): DevicesJson {
	try {
		const j = JSON.parse(raw)
		if (!isObj(j) || !Array.isArray(j.devices)) {
			return emptyDevices()
		}
		return {
			schema: 1,
			probedAt: str(j.probedAt),
			devices: j.devices.filter(isObj).map((d) => ({
				id: str(d.id) ?? "unknown",
				kind: (str(d.kind) as KnownDevice["kind"]) ?? "other",
				description: str(d.description),
				board: str(d.board),
				family: str(d.family),
				port: str(d.port),
				mode: str(d.mode),
				lastSeenAt: str(d.lastSeenAt),
				lastFlashedAt: str(d.lastFlashedAt),
			})),
		}
	} catch {
		return emptyDevices()
	}
}

export function parseEnv(raw: string): EnvJson {
	try {
		const j = JSON.parse(raw)
		if (!isObj(j)) {
			return emptyEnv()
		}
		return {
			schema: 1,
			ncsVersions: strArr(j.ncsVersions),
			ncsProjectVersion: str(j.ncsProjectVersion),
			ncsRoots: isObj(j.ncsRoots) ? (j.ncsRoots as Record<string, string>) : undefined,
			idfVersion: str(j.idfVersion),
			idfProjectVersion: str(j.idfProjectVersion),
			idfPath: str(j.idfPath),
			pythonVersion: str(j.pythonVersion),
			detectedAt: str(j.detectedAt),
		}
	} catch {
		return emptyEnv()
	}
}
