/**
 * Two small facts about asks that the seam and the terminal both depend on.
 *
 * 1. Every ask gets a timestamp strictly later than the last message. A streaming command asks once per
 *    output chunk, and on 14 September three `command_output` asks in one run carried the SAME
 *    millisecond. The ts is the ask's identity twice over: the task decides an earlier ask was
 *    superseded by comparing it, and the seam refuses a stale answer by comparing it. Two asks with one
 *    ts are, to both checks, one ask — an answer read against the first lands on the second.
 *
 * 2. An ask that was superseded is not an error. A command's output ask is replaced the moment more
 *    output or the command's end arrives; the task then rejects the older promise with "Current ask
 *    promise was ignored". The terminal logged each one at ERROR — six in one run — which reads in the
 *    host log as a fault and sent a driver looking for asks it could never have answered.
 */

/** A timestamp for a new ask: now, but never at or before the last message's. */
export function nextAskTs(lastMessageTs: number | undefined, now: number = Date.now()): number {
	const last = Number(lastMessageTs ?? 0)
	return now > last ? now : last + 1
}

/** True when an ask rejected because a later message replaced it — the expected end of a streaming ask. */
export function isSupersededAsk(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err ?? "")
	return msg.startsWith("Current ask promise was ignored")
}
