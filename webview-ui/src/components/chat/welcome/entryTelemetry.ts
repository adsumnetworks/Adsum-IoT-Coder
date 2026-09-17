import { EntryEventRequest } from "@shared/proto/cline/state"
import { StateServiceClient } from "@/services/grpc-client"

/**
 * The four entry-surface counters.
 *
 * The cockpit replaced a screen nobody had measured, so it does not get to claim it is better.
 * These four say whether it is: how fast a developer reaches their first prompt, how often the
 * named resume is the thing they wanted, how often they go looking in the drawer, and how often
 * a suggested run is actually started.
 *
 * The reversal rule is pre-committed and reads exactly one of them: if `entry_build_start` per
 * `entry_shown` falls below the baseline over two weeks, the cards come back for returning users.
 * A number decides it, not a preference.
 *
 * Fire-and-forget by design — a counter must never delay or break the surface it measures.
 */

let shownAt = 0
let firstPromptSent = false
/** Impressions already counted on this paint, so a re-render is never a second impression. */
const shownCards = new Set<string>()

const send = (event: string, properties: Record<string, string>) => {
	// Guarded on both axes, because a counter must never take down the surface it measures.
	// A rejected promise is the easy case; the one that actually bites is a host without this
	// route at all — an older extension, or a test double — where the call throws synchronously
	// during render and white-screens the entry surface. Measuring is never worth that.
	try {
		StateServiceClient.captureEntryEvent?.(EntryEventRequest.create({ event, properties }))?.catch(() => {})
	} catch {
		// Telemetry off, host older than this route, or no client at all. None is the surface's problem.
	}
}

/** The cockpit painted. Resets the clock the first-prompt timing is measured against. */
export function entryShown(p: {
	mode: string
	reason: string
	sessions: number
	newestAgeDays: number
	roots: number
	hasResume: boolean
}): void {
	shownAt = Date.now()
	firstPromptSent = false
	shownCards.clear()
	send("entry_shown", {
		mode: p.mode,
		// [POSTHOG 2026-09-04] `mode` alone cannot be acted on: "expanded" covers a first-ever
		// visit, a single past session, a month away, and a folder never worked in, and the fix
		// for each is different. `entryMode` already decides which, so recording it costs nothing
		// and turns the counter from a tally into a diagnosis.
		reason: p.reason,
		// Whether a resume was on offer at all — the denominator for "was the named resume the
		// thing they wanted", which `entry_first_prompt via=resume` is otherwise measured against
		// blind.
		has_resume: String(p.hasResume),
		sessions: String(p.sessions),
		newest_age_d: p.newestAgeDays ? p.newestAgeDays.toFixed(1) : "0",
		roots: String(p.roots),
	})
}

/** The developer's first act on this paint, and how long it took them to get there. */
export function entryFirstPrompt(via: "typed" | "card" | "resume" | "sample"): void {
	if (firstPromptSent || !shownAt) {
		return
	}
	firstPromptSent = true
	send("entry_first_prompt", { via, ms_since_shown: String(Date.now() - shownAt) })
}

export function entryDrawerOpen(hadNewRun: boolean): void {
	// via: the "All runs" line under the cards — the ☰ that used to open it is gone (2026-09-09).
	send("entry_drawer_open", { via: "all-runs", had_new_build: String(hadNewRun) })
}

/** A run was started — the number the reversal rule reads. */
export function entryRunStart(runId: string, via: "card" | "drawer" | "sample"): void {
	entryFirstPrompt(via === "sample" ? "sample" : "card")
	send("entry_build_start", { build_id: runId, via })
}

/**
 * The register funnel: which surface asked, and for which card.
 *
 * One event per OPEN, not per render — the panel re-renders on every keystroke behind it, and a
 * gate counted per paint would make the funnel's denominator meaningless.
 */
export function gateShown(surface: string, intent?: string): void {
	send("gate_shown", { surface, ...(intent ? { intent } : {}) })
}

/** The full environment view opened — from the row itself, or from an exception's "why →". */
export function entryEnvOpen(via: "row" | "why" | "always"): void {
	send("entry_env_open", { via })
}

/**
 * A card was on screen. Once per card, per state, per paint: the panel re-renders on every keystroke
 * behind it, and an impression counted per render would make every rate built on it meaningless.
 *
 * Properties are enums, ids and booleans — which card, which rung, what the account already holds.
 * Never an email, a path, a board serial or anything typed.
 */
export function cardShown(card: string, properties: Record<string, string> = {}): void {
	const key = `${card}|${Object.entries(properties)
		.map(([k, v]) => `${k}=${v}`)
		.join("&")}`
	if (shownCards.has(key)) {
		return
	}
	shownCards.add(key)
	send("card_shown", { card, ...properties })
}

/** A deliberate act on a card: which card, which action, and the enum that says which way. */
export function cardAction(card: string, action: string, properties: Record<string, string> = {}): void {
	send("card_action", { card, action, ...properties })
}
