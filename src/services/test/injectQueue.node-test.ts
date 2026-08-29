import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"
import {
	checkInject,
	drainNotes,
	formatNote,
	MAX_NOTE_CHARS,
	MAX_QUEUED_NOTES,
	queuedCount,
	queueNote,
	resetNotesForTests,
} from "./injectQueue"

/**
 * The seam could answer questions and nothing else, and three times on 2026-08-29 that was the binding
 * constraint — a human knew something the agent needed (the board is beside a window; the modem firmware
 * was just updated; here is what the operator's platform says) and had no way to say it.
 *
 * This is also the one part of the seam that can corrupt a run, so most of these tests are about refusing.
 */
describe("telling a running session something it did not ask", () => {
	beforeEach(() => resetNotesForTests())

	test("a plain note is accepted and waits for the next turn", () => {
		const check = checkInject(JSON.stringify({ text: "the board is beside a window" }), false, 0)
		assert.equal(check.ok, true)
		if (check.ok) {
			assert.equal(check.text, "the board is beside a window")
		}
	})

	/**
	 * The rule that keeps the two delivery paths from overlapping. /respond echoes the ask's ts so two
	 * answers cannot race; an injection during an ask has no such guard and would land beside the answer.
	 */
	test("refused while an ask is pending, and says to use /respond instead", () => {
		const check = checkInject(JSON.stringify({ text: "anything" }), true, 0)
		assert.equal(check.ok, false)
		if (!check.ok) {
			assert.equal(check.status, 409)
			assert.match(check.error, /\/respond/)
		}
	})

	test("an empty or malformed note is refused, not queued as nothing", () => {
		assert.equal(checkInject("not json", false, 0).ok, false)
		assert.equal(checkInject(JSON.stringify({ text: "   " }), false, 0).ok, false)
		assert.equal(checkInject(JSON.stringify({}), false, 0).ok, false)
	})

	test("an oversized note is refused rather than truncated — half a fact is worse than none", () => {
		const check = checkInject(JSON.stringify({ text: "x".repeat(MAX_NOTE_CHARS + 1) }), false, 0)
		assert.equal(check.ok, false)
		if (!check.ok) {
			assert.equal(check.status, 400)
		}
	})

	/**
	 * Refused, never dropped. A silently discarded note is the worse failure: the driver believes the
	 * agent was told, and reasons from then on as though it knows.
	 */
	test("a full queue refuses the new note and keeps the ones already waiting", () => {
		for (let i = 0; i < MAX_QUEUED_NOTES; i++) {
			queueNote(`note ${i}`)
		}
		const check = checkInject(JSON.stringify({ text: "one more" }), false, queuedCount())
		assert.equal(check.ok, false)
		if (!check.ok) {
			assert.equal(check.status, 429)
			assert.match(check.error, /nothing was dropped/)
		}
		assert.equal(queuedCount(), MAX_QUEUED_NOTES)
	})

	test("a note is labelled as a human's, never as the agent's own observation", () => {
		const note = formatNote("the antenna is fitted", "ismail")
		assert.match(note, /^\[note from ismail, sent while the task was running\]/)
		assert.match(note, /the antenna is fitted/)
		assert.match(formatNote("x"), /^\[note, sent while the task was running\]/)
	})

	test("draining hands each note over exactly once", () => {
		queueNote("first")
		queueNote("second")
		const drained = drainNotes()
		assert.equal(drained.length, 2)
		assert.match(drained[0], /first/)
		assert.deepEqual(drainNotes(), [], "a second turn must not repeat the note")
		assert.equal(queuedCount(), 0)
	})

	test("draining an empty queue is the normal case and costs nothing", () => {
		assert.deepEqual(drainNotes(), [], "every run that is not being driven takes this path every turn")
	})
})
