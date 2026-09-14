/**
 * A watchdog over the provider's response stream.
 *
 * [BENCH 2026-09-07, I-62] Roughly one bench run in nine froze: the transcript stopped
 * mid-sentence, the task sat at `state: running` for ever, no error was logged and no
 * retry fired. Measured over the 80 tasks of the 6 Sep matrix — 9 froze (11%), which is
 * about one N=3 set in three, and that is where the "one run in three" impression came
 * from. Two shapes, one cause:
 *
 *   5 tasks  last message `reasoning`        — the stream died mid-response
 *   4 tasks  last message `api_req_started`  — the first chunk never arrived
 *
 * The cause is that `await iterator.next()` and `yield* iterator` in Task#attemptApiRequest
 * have no upper bound. A provider that stops sending without erroring and without closing
 * the stream leaves the `for await` in Task#recursivelyMakeClineRequests parked for ever:
 * nothing throws, so the catch that carries the auto-retry ladder is never entered. The
 * task is not slow, it is gone, and the product cannot tell the difference.
 *
 * This wrapper makes silence an error. Every `next()` races the inner iterator against a
 * budget; when the budget expires the underlying request is aborted and a StreamStalledError
 * is thrown — which lands in the error handling that already exists, so a stalled stream now
 * takes the same 2 s / 4 s / 8 s retry ladder as any other streaming failure.
 *
 * It does NOT try to be clever about what "too long" means. Between-chunk gaps in a healthy
 * stream are milliseconds; the budgets below are two orders of magnitude larger than that,
 * so a false positive costs one retried request and a false negative costs the whole run.
 */

/** No first chunk within this long and the request is treated as lost, not queued. */
export const STREAM_FIRST_CHUNK_MS = envMs("ADSUM_STREAM_FIRST_CHUNK_MS", 120_000)
/** No further chunk within this long and the stream is treated as dead, not thinking. */
export const STREAM_IDLE_MS = envMs("ADSUM_STREAM_IDLE_MS", 90_000)

/**
 * Both budgets are overridable from the environment, and 0 disables the watchdog. That is
 * not a convenience: a guard nobody has seen fire is not a guard, and the bench needs to be
 * able to set the budget to two seconds and watch a healthy run get killed before it will
 * believe the watchdog is wired to anything.
 */
function envMs(name: string, fallback: number): number {
	const raw = process.env[name]
	if (raw === undefined) {
		return fallback
	}
	const n = Number(raw)
	return Number.isFinite(n) && n >= 0 ? n : fallback
}

export class StreamStalledError extends Error {
	readonly silentMs: number
	readonly beforeFirstChunk: boolean
	constructor(silentMs: number, beforeFirstChunk: boolean) {
		const seconds = Math.round(silentMs / 1000)
		super(
			beforeFirstChunk
				? `The request left but the model sent nothing back for ${seconds}s. Treating it as a lost stream rather than waiting for ever.`
				: `The model stopped mid-response — nothing for ${seconds}s. Treating it as a dead stream rather than waiting for ever.`,
		)
		this.name = "StreamStalledError"
		this.silentMs = silentMs
		this.beforeFirstChunk = beforeFirstChunk
	}
}

export interface StallWatchdogOptions {
	/** Budget for the first chunk. 0 disables it. */
	firstChunkMs?: number
	/** Budget between chunks once the stream has started. 0 disables it. */
	idleMs?: number
	/** Cancel the underlying HTTP request. Called once, before the error is thrown. */
	abort?: () => void
	/** True while the task is being cancelled — a cancel must not be reported as a stall. */
	isCancelled?: () => boolean
	/** Called when the watchdog fires, for the log. */
	onStall?: (error: StreamStalledError) => void
	/** Injectable clock, so the test does not have to wait ninety seconds. */
	now?: () => number
}

type Verdict<T> = { kind: "chunk"; value: IteratorResult<T> } | { kind: "stalled"; silentMs: number }

/**
 * Iterable as well as an iterator, and it accepts whatever a delegating generator sends, so
 * `yield* guardStream(...)` type-checks where a bare AsyncIterator would not.
 */
// TReturn is `any` to match the AsyncGenerator the providers hand us: callers read
// `.value` off the first chunk and expect the element type, not a union with the return type.
export type GuardedStream<T> = AsyncIterator<T, any, unknown> & {
	[Symbol.asyncIterator](): GuardedStream<T>
}

/**
 * Wrap an async iterator so that silence longer than the budget throws instead of hanging.
 *
 * The inner iterator is never dropped on the floor: when the watchdog wins the race the
 * pending `next()` promise keeps a catch attached, so abandoning it cannot surface later as
 * an unhandled rejection in the extension host.
 */
export function guardStream<T>(inner: AsyncIterator<T>, opts: StallWatchdogOptions = {}): GuardedStream<T> {
	const firstChunkMs = opts.firstChunkMs ?? STREAM_FIRST_CHUNK_MS
	const idleMs = opts.idleMs ?? STREAM_IDLE_MS
	const now = opts.now ?? Date.now
	let sawFirstChunk = false
	let aborted = false

	const abortOnce = () => {
		if (aborted) {
			return
		}
		aborted = true
		try {
			opts.abort?.()
		} catch {
			// A provider that throws on abort must not mask the stall we are reporting.
		}
	}

	const guarded: GuardedStream<T> = {
		[Symbol.asyncIterator]() {
			return guarded
		},

		async next(): Promise<IteratorResult<T>> {
			const budget = sawFirstChunk ? idleMs : firstChunkMs
			const pending = inner.next()
			if (budget <= 0) {
				const value = await pending
				sawFirstChunk = true
				return value
			}

			let timer: ReturnType<typeof setTimeout> | undefined
			const startedAt = now()
			const verdict = await Promise.race<Verdict<T>>([
				pending.then((value) => ({ kind: "chunk", value }) as const),
				new Promise<Verdict<T>>((resolve) => {
					timer = setTimeout(() => resolve({ kind: "stalled", silentMs: now() - startedAt }), budget)
				}),
			]).finally(() => clearTimeout(timer))

			if (verdict.kind === "chunk") {
				sawFirstChunk = true
				return verdict.value
			}

			// The watchdog won. Whatever the inner iterator eventually does, nobody is listening.
			pending.catch(() => {})

			// A task being cancelled looks exactly like a stall from here, and reporting a cancel
			// as a provider failure would send the user a retry they never asked for. End the
			// stream cleanly instead and let the caller's own abort handling take it from there.
			if (opts.isCancelled?.()) {
				abortOnce()
				return { done: true, value: undefined as unknown as T }
			}

			abortOnce()
			const error = new StreamStalledError(verdict.silentMs, !sawFirstChunk)
			opts.onStall?.(error)
			throw error
		},

		// `for await` calls return() when the consumer breaks out of the loop. Forwarding it is
		// what actually closes the socket; without it a broken-out-of stream leaks a request.
		async return(value?: unknown): Promise<IteratorResult<T>> {
			try {
				return (await inner.return?.(value)) ?? { done: true, value: value as T }
			} catch {
				return { done: true, value: value as T }
			}
		},

		async throw(error?: unknown): Promise<IteratorResult<T>> {
			if (inner.throw) {
				return inner.throw(error)
			}
			throw error
		},
	}
	return guarded
}

/**
 * A stall is retried once, then shown. Three retries at 2 s / 4 s / 8 s on top of a 90–120 s silence budget kept a
 * frozen turn on screen for eight minutes before the developer saw anything; one retry covers a dropped
 * connection, and a second silence in a row is the provider, which the developer should hear about.
 */
export const STALL_AUTO_RETRIES = 1
export const DEFAULT_AUTO_RETRIES = 3

export function autoRetryLimitFor(error: unknown): number {
	return error instanceof StreamStalledError ? STALL_AUTO_RETRIES : DEFAULT_AUTO_RETRIES
}

export interface TurnWatchdog {
	/** Call on every chunk and every completed piece of handling: this is progress. */
	touch(): void
	stop(): void
	/** The stall this watchdog raised, if it fired. */
	readonly stalled: StreamStalledError | undefined
}

/**
 * The idle budget over the WHOLE turn, not only over `next()`.
 *
 * `guardStream` times the wait for the next chunk. It cannot see time spent handling a chunk: a turn parked in
 * that handling (a delivery nobody acknowledges, a write that never returns) does not call `next()` at all, so
 * its timer never starts. This checks from outside the loop. A turn waiting on the developer — an ask on screen —
 * is not stalled and is never timed out.
 */
export function startTurnWatchdog(opts: {
	idleMs?: number
	isWaitingForUser: () => boolean
	onStall: (error: StreamStalledError) => void
	now?: () => number
	checkEveryMs?: number
}): TurnWatchdog {
	const idleMs = opts.idleMs ?? STREAM_IDLE_MS
	const now = opts.now ?? Date.now
	let last = now()
	let stalled: StreamStalledError | undefined
	let timer: ReturnType<typeof setInterval> | undefined
	if (idleMs > 0) {
		timer = setInterval(
			() => {
				if (stalled) {
					return
				}
				if (opts.isWaitingForUser()) {
					last = now()
					return
				}
				const silent = now() - last
				if (silent >= idleMs) {
					stalled = new StreamStalledError(silent, false)
					if (timer) {
						clearInterval(timer)
					}
					opts.onStall(stalled)
				}
			},
			opts.checkEveryMs ?? Math.max(250, Math.min(5000, Math.floor(idleMs / 4))),
		)
		;(timer as { unref?: () => void }).unref?.()
	}
	return {
		touch() {
			last = now()
		},
		stop() {
			if (timer) {
				clearInterval(timer)
			}
		},
		get stalled() {
			return stalled
		},
	}
}
