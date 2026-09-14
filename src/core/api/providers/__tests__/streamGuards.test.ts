import { strict as assert } from "node:assert"
import { ChunkLogSampler, guardedChunks, isEmptyChunk, StreamStalledError } from "../streamGuards"

/**
 * The bench session this comes from: one chunk, `finish_reason: null`, delta with `content: null`
 * and `reasoning_content: ""`, repeated until someone killed the extension host by pid. Twenty
 * minutes at a full core, 11 MB of log, ten connections open, and the task showing idle.
 */
const EMPTY_CHUNK = {
	id: "94419677-2bb8-4717-a748-5ffd929cf2bb",
	object: "chat.completion.chunk",
	created: 1789343364,
	choices: [{ index: 0, delta: { content: null, reasoning_content: "" }, finish_reason: null }],
	usage: null,
}
const TEXT_CHUNK = { id: "c1", choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] }
const DONE_CHUNK = { id: "c2", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }

async function* fromArray<T>(items: T[], afterEach?: () => void): AsyncGenerator<T> {
	for (const item of items) {
		yield item
		afterEach?.()
	}
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = []
	for await (const item of source) {
		out.push(item)
	}
	return out
}

describe("a stream that stops making progress", () => {
	it("ends the request when the same empty chunk repeats, and never processes it twice", async () => {
		const repeated = Array.from({ length: 500 }, () => ({ ...EMPTY_CHUNK }))
		let processed = 0
		await assert.rejects(
			async () => {
				for await (const _chunk of guardedChunks(fromArray(repeated), { maxRepeats: 20 })) {
					processed += 1
				}
			},
			(err: unknown) => {
				assert.ok(err instanceof StreamStalledError)
				assert.equal((err as StreamStalledError).reason, "repeating")
				// The words a developer reads: what happened, and what is safe.
				assert.match(err.message, /repeated the same empty message/)
				assert.match(err.message, /work so far is kept/)
				return true
			},
		)
		assert.equal(processed, 0, "an empty chunk carries nothing to process — not once, not 500 times")
	})

	it("ends the request when nothing arrives at all for the idle budget", async () => {
		const silent: AsyncIterable<unknown> = {
			[Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
		}
		await assert.rejects(
			async () => {
				await collect(guardedChunks(silent, { idleMs: 30 }))
			},
			(err: unknown) => {
				assert.ok(err instanceof StreamStalledError)
				assert.equal((err as StreamStalledError).reason, "idle")
				assert.match(err.message, /stopped arriving/)
				return true
			},
		)
	})

	it("releases the upstream connection however it ends", async () => {
		let returned = false
		const source: AsyncIterable<unknown> = {
			[Symbol.asyncIterator]: () => ({
				next: async () => ({ value: { ...EMPTY_CHUNK }, done: false }),
				return: async () => {
					returned = true
					return { value: undefined, done: true as const }
				},
			}),
		}
		await assert.rejects(async () => {
			await collect(guardedChunks(source, { maxRepeats: 5 }))
		})
		assert.ok(returned, "ten connections were open on the bench; the guard must close its own")
	})
})

describe("a stream that is working normally", () => {
	it("passes every chunk that carries something, untouched and in order", async () => {
		const chunks = await collect(guardedChunks(fromArray([TEXT_CHUNK, EMPTY_CHUNK, TEXT_CHUNK, DONE_CHUNK])))
		assert.deepEqual(chunks, [TEXT_CHUNK, TEXT_CHUNK, DONE_CHUNK])
	})

	it("does not cut a model that legitimately repeats itself", async () => {
		// The same WORD twice is not the same as no progress, and a guard that confused them would be
		// a worse defect than the one it replaced.
		const same = { id: "c", choices: [{ index: 0, delta: { content: "the" }, finish_reason: null }] }
		const chunks = await collect(guardedChunks(fromArray(Array.from({ length: 200 }, () => same)), { maxRepeats: 5 }))
		assert.equal(chunks.length, 200)
	})

	it("knows an empty chunk from a useful one", () => {
		assert.equal(isEmptyChunk(EMPTY_CHUNK), true)
		assert.equal(isEmptyChunk(TEXT_CHUNK), false)
		assert.equal(isEmptyChunk(DONE_CHUNK), false)
		assert.equal(isEmptyChunk({ choices: [{ delta: { tool_calls: [{ index: 0 }] } }] }), false)
		assert.equal(isEmptyChunk({ usage: { prompt_tokens: 10 } }), false)
	})
})

describe("the raw-chunk log", () => {
	it("keeps the first few, then at most one a second, and says what it held back", () => {
		let now = 0
		const sampler = new ChunkLogSampler(3, 1000, () => now)
		assert.deepEqual([sampler.shouldLog(), sampler.shouldLog(), sampler.shouldLog()], [true, true, true])
		// 10,000 more in the same second: one line, not ten thousand.
		let logged = 0
		for (let i = 0; i < 10_000; i++) {
			if (sampler.shouldLog()) {
				logged += 1
			}
		}
		assert.equal(logged, 0)
		now = 1500
		assert.equal(sampler.shouldLog(), true)
		assert.match(sampler.summary() ?? "", /10000 not logged/)
	})

	it("says nothing at all when nothing was held back", () => {
		const sampler = new ChunkLogSampler(5, 1000, () => 0)
		sampler.shouldLog()
		assert.equal(sampler.summary(), undefined)
	})
})
