/**
 * Hand a message to the webview without waiting for it to be delivered.
 *
 * `webview.postMessage` resolves when the panel has taken the message. A panel that is hidden, collapsed or not
 * ready yet takes it late — minutes, on the bench — and every caller that awaited delivery waited with it: the
 * task's say(), postStateToWebview, the stream loop behind them. A task froze because its panel was in the
 * background. Posting order is kept (the calls are made in order, synchronously); only the wait is dropped,
 * and a failed delivery is logged, never thrown into the task.
 */
export interface PostTarget {
	postMessage(message: unknown): Thenable<boolean>
}

export function deliverToWebview(
	target: PostTarget | undefined,
	message: unknown,
	onError?: (e: unknown) => void,
): Promise<boolean | undefined> {
	if (!target) {
		return Promise.resolve(undefined)
	}
	try {
		Promise.resolve(target.postMessage(message)).then(undefined, (e) => onError?.(e))
	} catch (e) {
		onError?.(e)
		return Promise.resolve(false)
	}
	return Promise.resolve(true)
}
