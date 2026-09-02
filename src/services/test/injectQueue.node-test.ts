import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { checkInject, MAX_NOTE_CHARS, MAX_QUEUED_NOTES, NoteQueue } from "./injectQueue"

/**
 * Telling a session something while it is working.
 *
 * The seam could answer questions and nothing else, and three times on 2026-08-29 that was the binding
 * constraint — a human knew something the agent needed (the board is beside a window; the modem firmware
 * was just updated; here is what the operator's platform says) and had no way to say it. The developer at
 * the keyboard had the same problem, and the chat box now queues through here too.
 *
 * This is also the one part of the seam that can corrupt a run, so most of these tests are about refusing.
 */
describe("telling a running session something it did not ask", () => {
	test("a plain note is accepted and waits for the next turn", () => {
		const check = checkInject(JSON.stringify({ text: "the board is beside a window" }), false, 0)
		assert.equal(check.ok, true)
		if (check.ok) {
			assert.equal(check.text, "the board is beside a window")
		}
	})

	/**
	 * The rule that keeps the two seam delivery paths from overlapping. /respond echoes the ask's ts so two
	 * answers cannot race; an injection during an ask has no such guard and would land beside the answer.
	 *
	 * The composer does NOT share this rule, and must not: when an ask is pending the chat box is the
	 * answer, so a message typed then never reaches this queue at all.
	 */
	test("the seam is refused while an ask is pending, and says to use /respond instead", () => {
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

	/** A malformed note is refused for being malformed, not for the state of the session. */
	test("shape is checked before the pending ask, so the error says what is actually wrong", () => {
		const check = checkInject(JSON.stringify({ text: "" }), true, 0)
		assert.equal(check.ok, false)
		if (!check.ok) {
			assert.equal(check.status, 400)
		}
	})
})

describe("the queue a task holds for its next turn", () => {
	const note = (text: string, over: Partial<{ source: "composer" | "seam"; from: string }> = {}) => ({
		text,
		source: over.source ?? ("composer" as const),
		from: over.from,
	})

	test("a queued message reports an id, which is what takes it back again", () => {
		const q = new NoteQueue()
		const first = q.push(note("check the LED"))
		assert.equal(first.ok, true)
		assert.ok(first.id, "an accepted message must be addressable before it is delivered")
		assert.equal(q.count(), 1)

		assert.equal(q.remove(first.id!), true)
		assert.equal(q.count(), 0)
		assert.equal(q.remove(first.id!), false, "removing twice must not pretend to have removed something")
	})

	test("ids are distinct even for messages queued in the same millisecond", () => {
		const q = new NoteQueue()
		const ids = ["a", "b", "c"].map((t) => q.push(note(t)).id)
		assert.equal(new Set(ids).size, 3)
	})

	/**
	 * Refused, never dropped. A silently discarded message is the worse failure: the sender believes the
	 * agent was told, and reasons from then on as though it knows.
	 */
	test("a full queue refuses the new message and keeps the ones already waiting", () => {
		const q = new NoteQueue()
		for (let i = 0; i < MAX_QUEUED_NOTES; i++) {
			assert.equal(q.push(note(`note ${i}`)).ok, true)
		}
		const overflow = q.push(note("one more"))
		assert.equal(overflow.ok, false)
		if (!overflow.ok) {
			assert.equal(overflow.status, 429)
			assert.match(overflow.error, /nothing was dropped/)
		}
		assert.equal(q.count(), MAX_QUEUED_NOTES)
	})

	test("an empty message is refused by the queue as well as by the seam", () => {
		const q = new NoteQueue()
		assert.equal(q.push(note("   ")).ok, false)
		assert.equal(q.count(), 0)
	})

	test("draining hands each message over exactly once, in the order it was sent", () => {
		const q = new NoteQueue()
		q.push(note("first"))
		q.push(note("second"))
		const drained = q.drain()
		assert.deepEqual(
			drained.map((n) => n.text),
			["first", "second"],
		)
		assert.deepEqual(q.drain(), [], "a second turn must not repeat the message")
		assert.equal(q.count(), 0)
	})

	test("draining an empty queue is the normal case and costs nothing", () => {
		assert.deepEqual(new NoteQueue().drain(), [], "every run nobody is talking to takes this path every turn")
	})

	test("images and files ride along with the message they were sent with", () => {
		const q = new NoteQueue()
		q.push({ text: "look at this", images: ["data:image/png;base64,AAAA"], files: ["/tmp/log.txt"], source: "composer" })
		const [delivered] = q.drain()
		assert.deepEqual(delivered.images, ["data:image/png;base64,AAAA"])
		assert.deepEqual(delivered.files, ["/tmp/log.txt"])
	})

	/** Stop pulls back what the developer typed; a driver's note is not theirs to reclaim. */
	test("the source of each message survives to delivery", () => {
		const q = new NoteQueue()
		q.push(note("typed in the chat box"))
		q.push(note("sent over the seam", { source: "seam", from: "ismail-mac" }))
		const drained = q.drain()
		assert.deepEqual(
			drained.map((n) => n.source),
			["composer", "seam"],
		)
		assert.equal(drained[1].from, "ismail-mac")
	})

	test("a snapshot cannot be used to mutate the queue behind its back", () => {
		const q = new NoteQueue()
		q.push(note("still waiting"))
		const snap = q.snapshot()
		snap[0].text = "rewritten"
		snap.pop()
		assert.equal(q.count(), 1)
		assert.equal(q.drain()[0].text, "still waiting")
	})

	/**
	 * The reason this class exists instead of a module-level array. A message meant for a task that was
	 * cancelled must not be delivered to whatever task starts next — it would read as an instruction about
	 * work the new task knows nothing about.
	 */
	test("clearing leaves nothing for the next turn, or for the next task", () => {
		const q = new NoteQueue()
		q.push(note("meant for the run that was cancelled"))
		q.clear()
		assert.equal(q.count(), 0)
		assert.deepEqual(q.drain(), [])
	})

	test("two tasks cannot see each other's messages", () => {
		const a = new NoteQueue()
		const b = new NoteQueue()
		a.push(note("for a"))
		assert.equal(b.count(), 0)
		assert.deepEqual(b.drain(), [])
		assert.equal(a.count(), 1)
	})
})
