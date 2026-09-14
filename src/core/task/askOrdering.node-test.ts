import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { checkRespond, pendingAskFrom } from "../../services/test/askBridge"
import { isSupersededAsk, nextAskTs } from "./askOrdering"

/**
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/task/askOrdering.node-test.ts
 */
describe("every ask has its own timestamp (host issue H3)", () => {
	test("three asks raised in one millisecond get three distinct, increasing timestamps", () => {
		const now = 1789352196297 // the millisecond three command_output asks shared on 14 September
		const a = nextAskTs(now - 5, now)
		const b = nextAskTs(a, now)
		const c = nextAskTs(b, now)
		assert.deepEqual([a, b, c], [now, now + 1, now + 2])
	})

	test("an answer read against the first of two same-millisecond asks is refused on the second", () => {
		const now = 1789352196297
		const first = nextAskTs(0, now)
		const second = nextAskTs(first, now)
		const readFirst = pendingAskFrom([{ type: "ask", ask: "command_output", text: "a", ts: first }])
		const nowPending = pendingAskFrom([
			{ type: "ask", ask: "command_output", text: "a", ts: first },
			{ type: "ask", ask: "command_output", text: "b", ts: second },
		])
		const late = checkRespond(JSON.stringify({ responseType: "yesButtonClicked", ts: readFirst?.ts }), nowPending)
		assert.equal(late.ok, false, "with a shared ts this answer would have landed on the wrong ask")
	})

	test("time moving normally is untouched", () => {
		assert.equal(nextAskTs(1000, 2000), 2000)
		assert.equal(nextAskTs(undefined, 2000), 2000)
	})

	test("a superseded ask is recognised; any other failure is not", () => {
		assert.equal(isSupersededAsk(new Error("Current ask promise was ignored")), true)
		assert.equal(isSupersededAsk(new Error("Current ask promise was ignored 2")), true)
		assert.equal(isSupersededAsk(new Error("Adsum IoT Coder instance aborted")), false)
		assert.equal(isSupersededAsk(undefined), false)
	})
})
