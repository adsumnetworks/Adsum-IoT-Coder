/**
 * B31b, 14 Sep — with the editor window hidden, every task step took up to a minute.
 *
 * Every `say()` and `startTask` awaited `postStateToWebview()`. Building that state reads things only the editor
 * client holds (secrets, for one), and a hidden window's renderer is throttled to about one timer tick a minute, so
 * each awaited state post waited for it: the prompt, the checkpoint, the request start and every credit line landed
 * exactly 60 s apart, and `task.initialization` read ≈240 s.
 *
 * The task path never waits on the panel. A state post is started and not awaited; while one is in flight, later
 * calls collapse into a single trailing post, so the panel still ends on the latest state once it catches up.
 */
export function coalescePost(post: () => Promise<void>, onError?: (e: unknown) => void): () => Promise<void> {
	let inFlight = false
	let pending = false

	const run = (): void => {
		inFlight = true
		pending = false
		let settled: Promise<void>
		try {
			settled = Promise.resolve(post())
		} catch (e) {
			settled = Promise.reject(e)
		}
		settled
			.catch((e) => onError?.(e))
			.finally(() => {
				inFlight = false
				if (pending) {
					run()
				}
			})
	}

	return () => {
		if (inFlight) {
			pending = true
		} else {
			run()
		}
		return Promise.resolve()
	}
}
