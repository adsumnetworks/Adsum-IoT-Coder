import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { guardStream, StreamStalledError } from "./stream-watchdog"

/**
 * The freeze (I-62): a provider that stops sending without erroring parked the task for ever.
 * These tests hold the watchdog to both halves of the bargain — it must fire on silence, and
 * it must not fire on a stream that is merely slow. The first test is the one that matters:
 * before it existed, the assertion below could not be made to fail, because nothing threw.
 */

/** A stream that yields `n` chunks and then goes silent for ever — the shape that froze the bench. */
function stallsAfter<T>(chunks: T[]): AsyncIterator<T> {
	let i = 0
	return {
		next() {
			if (i < chunks.length) {
				return Promise.resolve({ done: false, value: chunks[i++] })
			}
			return new Promise<IteratorResult<T>>(() => {}) // never settles. This is the bug.
		},
	}
}

const drain = async <T>(it: AsyncIterator<T>) => {
	const out: T[] = []
	for (;;) {
		const r = await it.next()
		if (r.done) {
			return out
		}
		out.push(r.value)
	}
}

describe("stream watchdog — silence is an error, not patience", () => {
	test("a stream that dies mid-response throws instead of hanging for ever", async () => {
		const guarded = guardStream(stallsAfter(["a", "b"]), { firstChunkMs: 200, idleMs: 40 })
		assert.deepEqual(await guarded.next(), { done: false, value: "a" })
		assert.deepEqual(await guarded.next(), { done: false, value: "b" })
		await assert.rejects(
			() => guarded.next(),
			(e: unknown) => {
				assert.ok(e instanceof StreamStalledError, "throws the typed error the retry ladder can see")
				assert.equal(e.beforeFirstChunk, false, "reports it as a mid-response death, not a lost request")
				assert.match(e.message, /stopped mid-response/)
				return true
			},
		)
	})

	test("a request whose first chunk never arrives is reported as a lost request", async () => {
		const guarded = guardStream(stallsAfter<string>([]), { firstChunkMs: 40, idleMs: 5_000 })
		await assert.rejects(
			() => guarded.next(),
			(e: unknown) => {
				assert.ok(e instanceof StreamStalledError)
				assert.equal(e.beforeFirstChunk, true)
				assert.match(e.message, /sent nothing back/)
				return true
			},
		)
	})

	test("the underlying request is aborted, exactly once, before the error is thrown", async () => {
		let aborts = 0
		const guarded = guardStream(stallsAfter<string>([]), {
			firstChunkMs: 20,
			abort: () => {
				aborts++
			},
		})
		await assert.rejects(() => guarded.next())
		await assert.rejects(() => guarded.next())
		assert.equal(aborts, 1, "a stalled socket is closed once, not once per attempted read")
	})

	test("a slow but progressing stream is left alone — this is what stops false positives", async () => {
		let i = 0
		const slow: AsyncIterator<number> = {
			next: () =>
				new Promise((resolve) =>
					setTimeout(() => resolve(i < 4 ? { done: false, value: i++ } : { done: true, value: undefined }), 30),
				),
		}
		// Each gap is 30 ms against a 90 ms budget: four chunks, no stall, total well past the budget.
		assert.deepEqual(await drain(guardStream(slow, { firstChunkMs: 90, idleMs: 90 })), [0, 1, 2, 3])
	})

	test("a cancel is not a stall — it ends the stream cleanly rather than raising a provider failure", async () => {
		let cancelled = false
		const guarded = guardStream(stallsAfter<string>([]), {
			firstChunkMs: 20,
			isCancelled: () => cancelled,
		})
		cancelled = true
		assert.deepEqual(await guarded.next(), { done: true, value: undefined })
	})

	test("breaking out of the loop closes the inner stream", async () => {
		let returned = false
		const inner: AsyncIterator<string> = {
			next: () => Promise.resolve({ done: false, value: "x" }),
			return: () => {
				returned = true
				return Promise.resolve({ done: true, value: undefined })
			},
		}
		const guarded = guardStream(inner, { firstChunkMs: 50, idleMs: 50 })
		for await (const _ of { [Symbol.asyncIterator]: () => guarded as AsyncIterator<string> }) {
			break
		}
		assert.ok(returned, "return() reaches the provider, so the socket is not leaked")
	})

	test("a budget of 0 disables the watchdog — the escape hatch actually escapes", async () => {
		const guarded = guardStream(stallsAfter(["only"]), { firstChunkMs: 0, idleMs: 0 })
		assert.deepEqual(await guarded.next(), { done: false, value: "only" })
		const raced = await Promise.race([
			guarded.next().then(() => "returned"),
			new Promise((r) => setTimeout(() => r("still waiting"), 60)),
		])
		assert.equal(raced, "still waiting", "with the watchdog off, the old hanging behaviour is back")
	})
})
