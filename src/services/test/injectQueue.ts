/**
 * Telling a running session something it has not thought to ask.
 *
 * The seam could answer questions and nothing else. Three times on 2026-08-29 that was the binding
 * constraint: the GNSS run could not be told the board was sitting beside a window; the connectivity run
 * could not be told the modem firmware had just been updated; and the SIM platform's own findings — the
 * APN, the operator's ping results — had to wait until the run happened to ask something before they
 * could be passed in. Facts a human had, that the agent needed, with no way across.
 *
 * THIS IS THE ONE PIECE OF THE SEAM THAT CAN CORRUPT A RUN, so the rules are narrow on purpose:
 *
 *  - Refused while an ask is pending. `/respond` exists for that moment and carries a `ts` echo so two
 *    answers cannot race; an injection then would slip text in beside the answer with no such guard.
 *  - Delivered only at a turn boundary, as its own labelled user block. Never mid-stream, never merged
 *    into a tool result — a note that arrives inside a tool result reads to the model as output from the
 *    tool, which is a fabricated observation, the precise class of failure this whole day was about.
 *  - Bounded, and refused rather than dropped when full. A silently discarded note is worse than a
 *    rejected one: the driver believes the agent was told.
 *
 * Pure, so all of that is testable without an extension host.
 */

/** Enough for a paragraph of context. Beyond this it is a task, not a note. */
export const MAX_NOTE_CHARS = 10_000
/** Enough to queue a few observations between turns; a driver with more to say should start a task. */
export const MAX_QUEUED_NOTES = 5

export type InjectCheck = { ok: true; text: string } | { ok: false; status: number; error: string }

/**
 * Whether this note may be queued right now.
 *
 * `hasPendingAsk` is the important one. It is not a courtesy — it is what keeps the two delivery paths
 * from overlapping.
 */
export function checkInject(rawBody: string, hasPendingAsk: boolean, queued: number): InjectCheck {
	let parsed: unknown
	try {
		parsed = JSON.parse(rawBody || "{}")
	} catch {
		return { ok: false, status: 400, error: "body must be JSON: { text: string, driver?: string }" }
	}
	const body = (parsed ?? {}) as { text?: unknown }
	const text = typeof body.text === "string" ? body.text.trim() : ""
	if (!text) {
		return { ok: false, status: 400, error: "need a non-empty { text }" }
	}
	if (text.length > MAX_NOTE_CHARS) {
		return { ok: false, status: 400, error: `text is longer than ${MAX_NOTE_CHARS} characters` }
	}
	if (hasPendingAsk) {
		return {
			ok: false,
			status: 409,
			error:
				"the session is waiting on an answer — use /respond, which echoes the ask's ts so two answers " +
				"cannot race. A note injected now would land beside the answer with no such guard.",
		}
	}
	if (queued >= MAX_QUEUED_NOTES) {
		return {
			ok: false,
			status: 429,
			error: `${MAX_QUEUED_NOTES} notes are already waiting for the next turn; nothing was dropped, but this one was not taken`,
		}
	}
	return { ok: true, text }
}

/**
 * How a note reads to the model.
 *
 * Labelled as coming from the person driving, and never disguised as tool output or as the agent's own
 * observation — the agent must be able to tell "a human told me this" from "I measured this", because the
 * second is a claim it can be held to.
 */
export function formatNote(text: string, driver?: string): string {
	const who = driver?.trim() ? ` from ${driver.trim()}` : ""
	return `[note${who}, sent while the task was running]\n${text}`
}

/** The queue itself: process-wide, because there is one driven session per extension host. */
const pending: string[] = []

export function queueNote(text: string, driver?: string): number {
	pending.push(formatNote(text, driver))
	return pending.length
}

export function queuedCount(): number {
	return pending.length
}

/** Take everything waiting. Called once at a turn boundary; delivering twice would repeat the note. */
export function drainNotes(): string[] {
	return pending.splice(0, pending.length)
}

/** Test seam: one test's queue must not leak into the next. */
export function resetNotesForTests(): void {
	pending.length = 0
}
