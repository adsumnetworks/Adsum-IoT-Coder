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
}

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
	return { kind: String(last.ask ?? ""), text: String(last.text ?? ""), ts: Number(last.ts ?? 0) }
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
