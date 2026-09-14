/**
 * Guards for a streamed completion that never ends.
 *
 * A real session on the bench: the upstream kept emitting ONE chunk — `finish_reason: null`, a delta
 * carrying `content: null` and `reasoning_content: ""` — and the handler's `for await` processed and
 * logged it forever. Twenty minutes at a full core, eleven megabytes of log (the same line 10,710
 * times), ten connections open, and the session showing idle the whole time because nothing was
 * being yielded to the task. The developer's machine was the only thing that noticed.
 *
 * Three guards, and each one alone would have stopped it:
 *   1. nothing new for a bounded time ends the request honestly,
 *   2. the same chunk arriving again and again is never processed twice,
 *   3. the raw-chunk log is sampled, because a handler that can write 11 MB in twenty minutes is a
 *      defect whatever else is true.
 *
 * They live here, apart from any one provider, because "the upstream stopped making progress" is not
 * a fact about a vendor.
 */

export class StreamStalledError extends Error {
	constructor(
		message: string,
		public readonly reason: "idle" | "repeating",
	) {
		super(message)
		this.name = "StreamStalledError"
	}
}

export interface StreamGuardOptions {
	/** No chunk at all for this long ends the request. */
	idleMs?: number
	/** The same chunk this many times in a row ends the request. */
	maxRepeats?: number
	/** Injected in tests. */
	setTimeoutFn?: typeof setTimeout
	clearTimeoutFn?: typeof clearTimeout
}

const DEFAULTS = { idleMs: 120_000, maxRepeats: 50 }

/** True when a chunk carries nothing a task could act on. Keep-alives look exactly like this. */
export function isEmptyChunk(chunk: unknown): boolean {
	const c = chunk as {
		choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }>
		usage?: unknown
	}
	if (c?.usage) {
		return false
	}
	const choice = c?.choices?.[0]
	if (!choice) {
		return true
	}
	if (choice.finish_reason) {
		return false
	}
	const delta = choice.delta ?? {}
	const content = delta.content
	const reasoning = delta.reasoning_content
	const tools = delta.tool_calls as unknown[] | undefined
	return !content && !reasoning && !(tools && tools.length > 0)
}

/**
 * The upstream stream, with the guards applied.
 *
 * Repeats are counted only for chunks that carry nothing — a model legitimately streams the same
 * word twice, and cutting a stream for saying "the" twice would be a worse bug than the one this
 * fixes. An identical EMPTY chunk, though, is by definition no progress.
 */
export async function* guardedChunks<T>(source: AsyncIterable<T>, options: StreamGuardOptions = {}): AsyncGenerator<T> {
	const idleMs = options.idleMs ?? DEFAULTS.idleMs
	const maxRepeats = options.maxRepeats ?? DEFAULTS.maxRepeats
	const setTimeoutFn = options.setTimeoutFn ?? setTimeout
	const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout

	const iterator = source[Symbol.asyncIterator]()
	let lastEmptySignature: string | undefined
	let repeats = 0

	try {
		while (true) {
			let timer: ReturnType<typeof setTimeout> | undefined
			const idle = new Promise<never>((_resolve, reject) => {
				timer = setTimeoutFn(
					() =>
						reject(
							new StreamStalledError(
								`The model's reply stopped arriving (nothing new for ${Math.round(idleMs / 1000)}s). ` +
									`Ending the request instead of waiting — the work so far is kept, and you can send it again.`,
								"idle",
							),
						),
					idleMs,
				)
			})
			let result: IteratorResult<T>
			try {
				result = await Promise.race([iterator.next(), idle])
			} finally {
				if (timer) {
					clearTimeoutFn(timer)
				}
			}
			if (result.done) {
				return
			}

			if (isEmptyChunk(result.value)) {
				const signature = JSON.stringify(result.value)
				if (signature === lastEmptySignature) {
					repeats += 1
					if (repeats >= maxRepeats) {
						throw new StreamStalledError(
							`The model's reply repeated the same empty message ${repeats} times without making progress. ` +
								`Ending the request instead of looping — the work so far is kept, and you can send it again.`,
							"repeating",
						)
					}
					// Never processed twice: an identical empty chunk is not news.
					continue
				}
				lastEmptySignature = signature
				repeats = 0
				continue
			}

			lastEmptySignature = undefined
			repeats = 0
			yield result.value
		}
	} finally {
		// Whatever ends this — return, throw, or the task cancelling — the upstream connection is
		// released. Ten of them were open on the bench.
		await iterator.return?.().catch(() => {})
	}
}

/**
 * Sampling for the raw-chunk debug log.
 *
 * The first few chunks are the ones worth having when something is wrong at the start; after that
 * one line a second is plenty, and the count of what was skipped is more useful than the lines
 * themselves.
 */
export class ChunkLogSampler {
	private seen = 0
	private skipped = 0
	private lastLoggedAt = 0

	constructor(
		private readonly firstN = 5,
		private readonly everyMs = 1000,
		private readonly now: () => number = Date.now,
	) {}

	/** True when this chunk should be written to the log. */
	shouldLog(): boolean {
		this.seen += 1
		if (this.seen <= this.firstN) {
			this.lastLoggedAt = this.now()
			return true
		}
		const at = this.now()
		if (at - this.lastLoggedAt >= this.everyMs) {
			this.lastLoggedAt = at
			return true
		}
		this.skipped += 1
		return false
	}

	/** What to say once, at the end, when anything was held back. */
	summary(): string | undefined {
		return this.skipped > 0 ? `AdsumFreeHandler: ${this.seen} chunks, ${this.skipped} not logged (sampled)` : undefined
	}
}
