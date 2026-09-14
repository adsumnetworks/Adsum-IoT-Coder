/**
 * The decision logic behind the test server's /ask and /respond endpoints.
 *
 * Pure on purpose. The endpoints themselves cannot be unit-tested — they need a live extension host, a
 * visible webview and a running task — but every rule that decides whether an answer is safe to deliver
 * can be, and those rules are where the corner cases live. An answer routed into the wrong moment is worse
 * than no answer at all: `handleWebviewAskResponse` injects text into whatever the task is waiting on, so
 * "answer nothing" or "answer the question after the one I read" corrupts a run silently.
 */

/** The minimum of a ClineMessage this module needs; keeps it free of the message type's churn. */
export interface AskLike {
	type?: string
	ask?: string
	text?: string
	ts?: number
	partial?: boolean
}

export interface PendingAsk {
	kind: string
	text: string
	ts: number
	/**
	 * Present and true on an ask a RUNNING command raises with each chunk of its output. Nobody has to
	 * answer it — the command goes on and the ask is replaced by the next chunk or by the command's end.
	 * Answering `yesButtonClicked` is the panel's "Proceed While Running"; any other answer is feedback.
	 */
	whileRunning?: true
}

/** Asks raised while something is still running, which replace themselves rather than wait for a person. */
export const STREAMING_ASKS = new Set(["command_output"])

/** Longest answer accepted. Generous for a considered reply, small enough that a runaway body is refused. */
export const MAX_ANSWER_CHARS = 10_000

/**
 * The ask a caller may answer right now, or null.
 *
 * Only the LAST message counts: an earlier ask has already been answered (the task appends as it goes), and
 * a `partial: true` message is still streaming — answering it would race the model's own completion of the
 * question it is asking.
 */
export function pendingAskFrom(messages: AskLike[] | undefined): PendingAsk | null {
	if (!messages?.length) {
		return null
	}
	const last = messages[messages.length - 1]
	if (!last || last.type !== "ask" || last.partial === true) {
		return null
	}
	const kind = String(last.ask ?? "")
	return {
		kind,
		text: String(last.text ?? ""),
		ts: Number(last.ts ?? 0),
		...(STREAMING_ASKS.has(kind) ? { whileRunning: true as const } : {}),
	}
}

export type RespondCheck =
	| { ok: true; responseType: "yesButtonClicked" | "noButtonClicked" | "messageResponse"; text?: string }
	| { ok: false; status: number; error: string }

const RESPONSE_TYPES = ["yesButtonClicked", "noButtonClicked", "messageResponse"] as const

/**
 * Whether this body may be delivered as an answer to `pending`.
 *
 * `expectTs` is optimistic concurrency, and it is the rule that matters most here: the developer watching
 * the window can click the same prompt I am answering, and both answers would otherwise land — the second
 * injected into whatever the task moved on to. A caller echoes the `ts` it read from /ask; if the pending
 * ask is no longer that one, the answer is refused as stale. Whoever gets there first wins, exactly as two
 * competing clicks would.
 */
export function checkRespond(rawBody: string, pending: PendingAsk | null, expectTsRequired = false): RespondCheck {
	let parsed: { responseType?: unknown; text?: unknown; ts?: unknown }
	try {
		parsed = JSON.parse(rawBody || "{}")
	} catch {
		return { ok: false, status: 400, error: "body is not valid JSON" }
	}

	const responseType = String(parsed.responseType ?? "")
	if (!(RESPONSE_TYPES as readonly string[]).includes(responseType)) {
		return {
			ok: false,
			status: 400,
			error: `unknown responseType '${responseType}' — expected one of ${RESPONSE_TYPES.join(", ")}`,
		}
	}

	if (!pending) {
		return { ok: false, status: 409, error: "no pending ask — refusing to answer nothing" }
	}

	if (parsed.ts !== undefined && Number(parsed.ts) !== pending.ts) {
		return {
			ok: false,
			status: 409,
			error: `stale answer: asked about ts ${Number(parsed.ts)}, current pending ask is ts ${pending.ts}`,
		}
	}
	if (expectTsRequired && parsed.ts === undefined) {
		return {
			ok: false,
			status: 400,
			error: "ts is required: echo the ts returned by /ask so a racing answer cannot land on the wrong question",
		}
	}

	const text = parsed.text === undefined ? undefined : String(parsed.text)
	if (responseType === "messageResponse" && !text?.trim()) {
		// An empty messageResponse reads as answered and behaves as unanswered — the worst of both.
		return { ok: false, status: 400, error: "messageResponse needs non-empty text" }
	}
	if (text !== undefined && text.length > MAX_ANSWER_CHARS) {
		return { ok: false, status: 400, error: `answer too long (${text.length} > ${MAX_ANSWER_CHARS})` }
	}

	return { ok: true, responseType: responseType as (typeof RESPONSE_TYPES)[number], text }
}

// ── what a run is doing right now ───────────────────────────────────────────────────────────────────

/**
 * The four states a driven session can be in, from the driver's point of view.
 *
 * `awaiting_human` and `complete` are the distinction this whole type exists to make. `/ask` returned the
 * pending ask's KIND and nothing else, so a driver had to infer "is this run finished, stuck, or thinking?"
 * from the shape of the transcript — and on 2026-08-29 two drivers inferred it wrong in opposite
 * directions within twenty minutes.
 *
 * The first watched file modification time, decided a run that had PARKED at the mistake limit was
 * finished, and posted a new task over the top of it; a hardware test was lost. The second was corrected to
 * refuse while anything was pending, and then refused to advance on `completion_result` — which IS the
 * finished signal, the "task done, anything else?" prompt. It logged its own confusion twice:
 *
 *     17:22:02  parked on 'completion_result' (idle 93s) — NOT posting
 *     17:22:23  parked on 'completion_result' (idle 114s) — NOT posting
 *
 * Both mistakes are the same missing fact, so the server states it rather than leaving each driver to
 * guess: finished is not stuck, and quiet is neither.
 */
export type SessionState = "idle" | "running" | "awaiting_human" | "complete"

/**
 * The completion ask. `attempt_completion` surfaces as `completion_result`, and answering it continues the
 * task with follow-up work rather than starting a new one — so a driver may still respond, but it must
 * know the run reached an end first.
 */
const COMPLETION_ASKS = new Set(["completion_result", "resume_completed_task"])

export function sessionStateFrom(messages: AskLike[] | undefined, hasTask: boolean): SessionState {
	if (!hasTask) {
		return "idle"
	}
	const pending = pendingAskFrom(messages)
	if (!pending) {
		// No pending ask: the task holds the floor. A partial ask lands here too, deliberately — the
		// question is still being written, and a driver that answered it would race the model finishing it.
		return "running"
	}
	if (STREAMING_ASKS.has(pending.kind)) {
		// A command still producing output. The run holds the floor; the ask is visible on /ask for a
		// driver that wants to proceed while it runs, but nobody is being waited on.
		return "running"
	}
	return COMPLETION_ASKS.has(pending.kind) ? "complete" : "awaiting_human"
}

/** The message shape `/messages` hands back: enough to follow a run, small enough to poll. */
export interface MessageDigest {
	ts: number
	type: string
	kind: string
	text: string
	partial?: boolean
}

/**
 * Everything the run has said since `sinceTs`, so a driver can see what it has LEARNED and not only what
 * it asks.
 *
 * The gap this closes: on 2026-08-29 an agent read `+CGDCONT: 0,"IP","wlapn.com","10.74.120.60"` off a
 * modem at 18:20:09 and never surfaced it — it was not an ask and not a completion, so the seam had no way
 * to show it. The driver learned the APN six minutes later from a human reading a web console, and found
 * the device's own reading only by grepping the task's ui_messages.json with an ad-hoc regex. Every fact
 * gathered that evening was extracted that way.
 *
 * Strictly greater than `sinceTs`, so a caller can pass back the last ts it saw and never re-read a
 * message or skip one.
 */
export function messagesSince(messages: AskLike[] | undefined, sinceTs: number): MessageDigest[] {
	if (!messages?.length) {
		return []
	}
	return messages
		.filter((m) => Number(m.ts ?? 0) > sinceTs)
		.map((m) => ({
			ts: Number(m.ts ?? 0),
			type: String(m.type ?? ""),
			kind: String(m.ask ?? (m as { say?: string }).say ?? ""),
			text: String(m.text ?? ""),
			...(m.partial === true ? { partial: true } : {}),
		}))
}
