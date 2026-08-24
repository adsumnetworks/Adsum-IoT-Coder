import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { type AskLike, checkRespond, MAX_ANSWER_CHARS, pendingAskFrom } from "./askBridge"

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
