/**
 * Telling a running session something it has not thought to ask.
 *
 * The seam could answer questions and nothing else. Three times on 2026-08-29 that was the binding
 * constraint: the GNSS run could not be told the board was sitting beside a window; the connectivity run
 * could not be told the modem firmware had just been updated; and the SIM platform's own findings — the
 * APN, the operator's ping results — had to wait until the run happened to ask something before they
 * could be passed in. Facts a human had, that the agent needed, with no way across.
 *
 * The developer at the keyboard had the same problem for longer, and worse: the composer is disabled
 * while a task runs, so the only ways to steer a run were to wait for an ask or to cancel it. Since
 * 2026-09-02 the chat box queues through here too, which is why this queue is no longer test-only
 * furniture — `source` says which door a note came in by.
 *
 * THIS IS THE ONE PIECE OF THE SEAM THAT CAN CORRUPT A RUN, so the rules are narrow on purpose:
 *
 *  - The seam is refused while an ask is pending. `/respond` exists for that moment and carries a `ts`
 *    echo so two answers cannot race; an injection then would slip text in beside the answer with no such
 *    guard. (The composer needs no such rule: when an ask is pending the chat box IS the answer, so it
 *    never reaches this queue. See useMessageHandlers.)
 *  - Delivered only at a turn boundary, as its own labelled user block. Never mid-stream, never merged
 *    into a tool result — a note that arrives inside a tool result reads to the model as output from the
 *    tool, which is a fabricated observation, the precise class of failure this whole day was about.
 *  - Bounded, and refused rather than dropped when full. A silently discarded note is worse than a
 *    rejected one: the sender believes the agent was told.
 *
 * The queue holds RAW text. The model-facing wrapper lives in formatResponse.queuedUserMessage, because
 * the same note is also written to the transcript verbatim as the developer's own message.
 *
 * Pure, so all of that is testable without an extension host.
 */

/** Enough for a paragraph of context. Beyond this it is a task, not a note. */
export const MAX_NOTE_CHARS = 10_000
/** Enough to queue a few observations between turns; anyone with more to say should start a task. */
export const MAX_QUEUED_NOTES = 5

export type InjectCheck = { ok: true; text: string } | { ok: false; status: number; error: string }

/** Which door a note came in by. The transcript labels them differently, and Stop only pulls back its own. */
export type NoteSource = "composer" | "seam"

export interface QueuedNote {
	id: string
	ts: number
	text: string
	images?: string[]
	files?: string[]
	source: NoteSource
	/** The driver name, for seam notes. The composer is always the developer at the keyboard. */
	from?: string
}

/**
 * The rules that do not depend on a pending ask: is there text, is it short enough, is there room.
 *
 * Shared by both doors so the composer cannot accidentally accept what the seam refuses.
 */
export function validateNote(text: string, queued: number): InjectCheck {
	const trimmed = typeof text === "string" ? text.trim() : ""
	if (!trimmed) {
		return { ok: false, status: 400, error: "need a non-empty { text }" }
	}
	if (trimmed.length > MAX_NOTE_CHARS) {
		return { ok: false, status: 400, error: `text is longer than ${MAX_NOTE_CHARS} characters` }
	}
	if (queued >= MAX_QUEUED_NOTES) {
		return {
			ok: false,
			status: 429,
			error: `${MAX_QUEUED_NOTES} notes are already waiting for the next turn; nothing was dropped, but this one was not taken`,
		}
	}
	return { ok: true, text: trimmed }
}

/**
 * Whether a note from the SEAM may be queued right now.
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
	const text = typeof body.text === "string" ? body.text : ""
	// Emptiness and length first, so a malformed note is refused for the reason it is malformed rather
	// than for the state of the session.
	const shape = validateNote(text, 0)
	if (!shape.ok) {
		return shape
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
	return validateNote(text, queued)
}

/**
 * The notes one task is holding for its next turn.
 *
 * Per task, not per process. A module-level array outlived the task that filled it: cancel a run with a
 * note still waiting and the next task inherited it, delivering a stale instruction to work it knew
 * nothing about. Owned by Task, cleared in abortTask, gone with the instance.
 */
export class NoteQueue {
	private pending: QueuedNote[] = []
	private seq = 0

	/** Queue a note, or say why not. The returned id is what removes it again before it is delivered. */
	push(note: Omit<QueuedNote, "id" | "ts">): InjectCheck & { id?: string } {
		const check = validateNote(note.text, this.pending.length)
		if (!check.ok) {
			return check
		}
		const id = `note-${Date.now().toString(36)}-${this.seq++}`
		this.pending.push({ ...note, text: check.text, id, ts: Date.now() })
		return { ...check, id }
	}

	/** Take one back out. Returns whether it was still there — a note already delivered cannot be unsent. */
	remove(id: string): boolean {
		const at = this.pending.findIndex((n) => n.id === id)
		if (at === -1) {
			return false
		}
		this.pending.splice(at, 1)
		return true
	}

	count(): number {
		return this.pending.length
	}

	/** A copy for the webview to render. Callers must not mutate the queue through it. */
	snapshot(): QueuedNote[] {
		return this.pending.map((n) => ({ ...n }))
	}

	/** Take everything waiting, in the order it was sent. Called once at a turn boundary; delivering twice would repeat the note. */
	drain(): QueuedNote[] {
		return this.pending.splice(0, this.pending.length)
	}

	clear(): void {
		this.pending.length = 0
	}
}
