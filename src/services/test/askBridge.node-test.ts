import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { type AskLike, checkRespond, MAX_ANSWER_CHARS, messagesSince, pendingAskFrom, sessionStateFrom } from "./askBridge"

/**
 * The rules that decide whether a remote answer may be delivered into a live session.
 *
 * handleWebviewAskResponse injects into whatever the task is currently waiting on, so the failure mode
 * here is not "the answer is rejected" — it is "the answer lands on the wrong question and nobody notices".
 * Every case below is one way that could happen.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/test/askBridge.node-test.ts
 */
const ask = (over: Partial<AskLike> = {}): AskLike => ({ type: "ask", ask: "followup", text: "pick one", ts: 1000, ...over })
const say = (over: Partial<AskLike> = {}): AskLike =>
	({ type: "say", say: "text", text: "thinking", ts: 900, ...over }) as AskLike

describe("pendingAskFrom", () => {
	test("the last message being an ask is the pending ask", () => {
		assert.deepEqual(pendingAskFrom([say(), ask()]), { kind: "followup", text: "pick one", ts: 1000 })
	})

	test("no messages, or none at all, is not an ask", () => {
		assert.equal(pendingAskFrom([]), null)
		assert.equal(pendingAskFrom(undefined), null)
	})

	test("a say after an ask means the ask was already answered", () => {
		// The task appends as it goes, so an ask that is no longer last has been dealt with. Reporting it
		// would invite an answer that lands on whatever comes next.
		assert.equal(pendingAskFrom([ask(), say({ ts: 1100 })]), null)
	})

	test("a PARTIAL ask is still being written and must not be answered", () => {
		// The model is mid-sentence composing the question; answering races its own completion.
		assert.equal(pendingAskFrom([say(), ask({ partial: true })]), null)
	})

	test("an ask with partial explicitly false is answerable", () => {
		assert.ok(pendingAskFrom([ask({ partial: false })]))
	})

	// B24, 14 Sep: a run whose saved transcript ends reasoning → a long answer → a closing followup was recorded as a
	// timeout. The answer-first rule puts a long text right before the ask in the same turn; the ask is still the
	// last message and must be the pending one, in the order the task writes it (partial ask, then finalised).
	test("a long answer followed by a closing followup in the same turn: the followup is pending", () => {
		const answer = { type: "say", say: "text", text: "The map is a prediction. ".repeat(400), ts: 135_000, partial: false }
		const reasoning = { type: "say", say: "reasoning", text: "thinking", ts: 120_000, partial: false }
		const question = JSON.stringify({ question: "How would you like to proceed?", options: ["Scan", "Lock", "Explain"] })
		const streaming = [reasoning, answer, { type: "ask", ask: "followup", text: question, ts: 193_000, partial: true }]
		assert.equal(pendingAskFrom(streaming), null, "not while the question is still being written")
		const final = [reasoning, answer, { type: "ask", ask: "followup", text: question, ts: 193_000, partial: false }]
		assert.deepEqual(pendingAskFrom(final), { kind: "followup", text: question, ts: 193_000 })
		assert.equal(sessionStateFrom(final, true), "awaiting_human")
	})

	test("a missing ask kind or text degrades to empty strings, never undefined", () => {
		const p = pendingAskFrom([{ type: "ask", ts: 5 }])
		assert.deepEqual(p, { kind: "", text: "", ts: 5 })
	})
})

describe("checkRespond", () => {
	const pending = { kind: "followup", text: "pick one", ts: 1000 }

	test("a well-formed answer to the current ask is accepted", () => {
		const r = checkRespond(JSON.stringify({ responseType: "messageResponse", text: "option two", ts: 1000 }), pending)
		assert.deepEqual(r, { ok: true, responseType: "messageResponse", text: "option two" })
	})

	test("button clicks need no text", () => {
		assert.deepEqual(checkRespond(JSON.stringify({ responseType: "yesButtonClicked" }), pending), {
			ok: true,
			responseType: "yesButtonClicked",
			text: undefined,
		})
	})

	test("malformed JSON is a 400, not a crash", () => {
		const r = checkRespond("{not json", pending)
		assert.equal(r.ok, false)
		assert.equal((r as { status: number }).status, 400)
	})

	test("an unknown responseType is refused", () => {
		const r = checkRespond(JSON.stringify({ responseType: "maybeButtonClicked" }), pending)
		assert.equal(r.ok, false)
		assert.match((r as { error: string }).error, /unknown responseType/)
	})

	test("answering when nothing is pending is a 409", () => {
		const r = checkRespond(JSON.stringify({ responseType: "yesButtonClicked" }), null)
		assert.equal(r.ok, false)
		assert.equal((r as { status: number }).status, 409)
		assert.match((r as { error: string }).error, /refusing to answer nothing/)
	})

	test("A STALE ts IS REFUSED — the developer clicked first and the task moved on", () => {
		// The race this whole mechanism has to survive: I read ts 1000, the human answers it, the task moves
		// to a new ask at ts 2000, and my answer arrives. Without this it lands on the new question.
		const r = checkRespond(JSON.stringify({ responseType: "messageResponse", text: "late", ts: 1000 }), {
			...pending,
			ts: 2000,
		})
		assert.equal(r.ok, false)
		assert.equal((r as { status: number }).status, 409)
		assert.match((r as { error: string }).error, /stale answer/)
	})

	test("omitting ts is allowed by default and required when the caller asks for strictness", () => {
		assert.equal(checkRespond(JSON.stringify({ responseType: "yesButtonClicked" }), pending).ok, true)
		const strict = checkRespond(JSON.stringify({ responseType: "yesButtonClicked" }), pending, true)
		assert.equal(strict.ok, false)
		assert.match((strict as { error: string }).error, /ts is required/)
	})

	test("an empty messageResponse is refused — it reads answered and behaves unanswered", () => {
		for (const text of ["", "   ", "\n\t"]) {
			const r = checkRespond(JSON.stringify({ responseType: "messageResponse", text }), pending)
			assert.equal(r.ok, false, `empty text ${JSON.stringify(text)} must be refused`)
			assert.match((r as { error: string }).error, /non-empty text/)
		}
	})

	test("an answer longer than the cap is refused rather than injected", () => {
		const r = checkRespond(
			JSON.stringify({ responseType: "messageResponse", text: "x".repeat(MAX_ANSWER_CHARS + 1) }),
			pending,
		)
		assert.equal(r.ok, false)
		assert.match((r as { error: string }).error, /too long/)
	})

	test("an answer exactly at the cap is fine", () => {
		const r = checkRespond(JSON.stringify({ responseType: "messageResponse", text: "x".repeat(MAX_ANSWER_CHARS) }), pending)
		assert.equal(r.ok, true)
	})

	test("responseType is checked before the pending ask, so a bad body is a 400 even with nothing pending", () => {
		const r = checkRespond(JSON.stringify({ responseType: "nope" }), null)
		assert.equal((r as { status: number }).status, 400)
	})
})

describe("what state a driven run is in", () => {
	const say = (ts: number, text = "working") => ({ type: "say", say: "text", text, ts })
	const ask = (kind: string, ts: number, partial?: boolean) => ({ type: "ask", ask: kind, text: "?", ts, partial })

	test("no task at all is idle, not finished and not stuck", () => {
		assert.equal(sessionStateFrom([], false), "idle")
		assert.equal(sessionStateFrom(undefined, false), "idle")
	})

	/**
	 * The mistake that cost a hardware test: a watcher read file modification time, saw a run that had
	 * PARKED at the mistake limit, decided it was finished and posted a new task over the top of it.
	 */
	test("parked at the mistake limit is awaiting_human — a quiet run is not a finished one", () => {
		assert.equal(sessionStateFrom([say(1), ask("mistake_limit_reached", 2)], true), "awaiting_human")
	})

	/**
	 * And the opposite mistake, twenty minutes later, from the watcher written to fix the first one:
	 *     17:22:02  parked on 'completion_result' (idle 93s) — NOT posting
	 *     17:22:23  parked on 'completion_result' (idle 114s) — NOT posting
	 * completion_result IS the finished signal. Refusing to advance on it is refusing to advance, ever.
	 */
	test("completion_result is complete — it is the done signal, not a park", () => {
		assert.equal(sessionStateFrom([say(1), ask("completion_result", 2)], true), "complete")
		assert.equal(sessionStateFrom([say(1), ask("resume_completed_task", 2)], true), "complete")
	})

	test("every other pending ask is a human being waited on", () => {
		for (const kind of ["followup", "tool", "command", "api_req_failed", "resume_task", "browser_action_launch"]) {
			assert.equal(sessionStateFrom([ask(kind, 2)], true), "awaiting_human", kind)
		}
	})

	test("a partial ask is still running — the question is not finished being written", () => {
		assert.equal(sessionStateFrom([ask("followup", 2, true)], true), "running")
	})

	test("a task whose last word was its own is running", () => {
		assert.equal(sessionStateFrom([ask("tool", 1), say(2)], true), "running")
	})
})

describe("what a run has learned, not only what it asks", () => {
	/**
	 * 2026-08-29: an agent read `+CGDCONT: 0,"IP","wlapn.com","10.74.120.60"` off a modem at 18:20:09 and
	 * never surfaced it — not an ask, not a completion, so the seam could not show it. The driver learned
	 * the APN six minutes later from a human reading a web console, and found the device's own reading
	 * only by grepping the task's ui_messages.json.
	 */
	const msgs = [
		{ type: "say", say: "text", text: "probing the modem", ts: 100 },
		{ type: "ask", ask: "command_output", text: '+CGDCONT: 0,"IP","wlapn.com","10.74.120.60"', ts: 200 },
		{ type: "say", say: "text", text: "the network assigned the APN", ts: 300 },
	]

	test("a fact the agent read is visible without grepping a transcript file", () => {
		const found = messagesSince(msgs, 0)
		assert.equal(found.length, 3)
		assert.ok(found.some((m) => m.text.includes("wlapn.com")))
		assert.equal(found[1].kind, "command_output")
	})

	test("sinceTs is strictly greater, so polling never repeats or skips a message", () => {
		assert.deepEqual(
			messagesSince(msgs, 200).map((m) => m.ts),
			[300],
		)
		assert.deepEqual(messagesSince(msgs, 300), [])
	})

	test("a partial is marked, so a driver does not read half a sentence as the answer", () => {
		const streaming = [{ type: "say", say: "text", text: "half a th", ts: 400, partial: true }]
		assert.equal(messagesSince(streaming, 0)[0].partial, true)
		assert.equal(messagesSince(msgs, 0)[0].partial, undefined)
	})

	test("no messages is an empty list, never a throw", () => {
		assert.deepEqual(messagesSince(undefined, 0), [])
		assert.deepEqual(messagesSince([], 0), [])
	})
})

describe("a running command's output ask (host issue H3)", () => {
	const say = (ts: number) => ({ type: "say", say: "command", text: "west build", ts })
	const out = (ts: number) => ({ type: "ask", ask: "command_output", text: "[1/200] Building C object", ts })

	test("it is visible on /ask, marked as raised while running", () => {
		assert.deepEqual(pendingAskFrom([say(1), out(2)]), {
			kind: "command_output",
			text: "[1/200] Building C object",
			ts: 2,
			whileRunning: true,
		})
	})

	test("the run is running, not awaiting a human — nobody has to answer a command's output", () => {
		assert.equal(sessionStateFrom([say(1), out(2)], true), "running")
	})

	test("it can be answered like the panel answers it, and a stale ts is still refused", () => {
		const pending = pendingAskFrom([say(1), out(2)])
		const proceed = checkRespond(JSON.stringify({ responseType: "yesButtonClicked", ts: 2 }), pending)
		assert.equal(proceed.ok, true)
		const stale = checkRespond(JSON.stringify({ responseType: "yesButtonClicked", ts: 1 }), pending)
		assert.equal(stale.ok, false)
	})

	test("other asks are unchanged: a followup still waits on a human and carries no running flag", () => {
		const f = { type: "ask", ask: "followup", text: "?", ts: 3 }
		assert.equal(sessionStateFrom([say(1), f], true), "awaiting_human")
		assert.equal(pendingAskFrom([f])?.whileRunning, undefined)
	})
})
