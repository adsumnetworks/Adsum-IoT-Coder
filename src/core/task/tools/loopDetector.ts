/**
 * [0.5 loop detection] A model that calls the same tool with the same arguments three times
 * running is not making progress, and one that fails the same way five times running is not
 * going to fix itself by trying again unchanged. This guard watches the calls it is shown and
 * hands back a verdict once either pattern is met, so the handler can tell the model what it is
 * repeating and that it is time to change approach or ask the developer, instead of letting the
 * loop run until the context window or the developer's patience runs out.
 */

export type LoopVerdictReason = "repeated-call" | "repeated-failure"

export interface LoopVerdict {
	reason: LoopVerdictReason
	toolName: string
	count: number
	message: string
}

interface CallRecord {
	toolName: string
	paramsKey: string
}

interface FailureRecord {
	toolName: string
	errorKey: string
}

/** How many identical calls in a row count as a loop. */
const CALL_REPEAT_THRESHOLD = 3
/** How many identical failures in a row count as a loop. */
const FAILURE_REPEAT_THRESHOLD = 5

/**
 * Normalises a tool's params so that key order (and the values plumbed through from the model's
 * own JSON) can't make two calls that are really the same look different.
 */
function normaliseParams(params: Record<string, unknown> | undefined): string {
	if (!params) {
		return ""
	}
	const sortedKeys = Object.keys(params).sort()
	const sorted: Record<string, unknown> = {}
	for (const key of sortedKeys) {
		sorted[key] = params[key]
	}
	return JSON.stringify(sorted)
}

export class LoopDetector {
	private lastCall: CallRecord | null = null
	private callStreak = 0
	private lastFailure: FailureRecord | null = null
	private failureStreak = 0

	/**
	 * Call once per tool invocation, before acting on it. Returns a verdict once this exact
	 * (tool, params) pair has been seen this many times with nothing different in between —
	 * a different tool, or the same tool with different params, resets the streak to 1.
	 */
	observeCall(toolName: string, params: Record<string, unknown> | undefined): LoopVerdict | null {
		const paramsKey = normaliseParams(params)
		if (this.lastCall && this.lastCall.toolName === toolName && this.lastCall.paramsKey === paramsKey) {
			this.callStreak++
		} else {
			this.lastCall = { toolName, paramsKey }
			this.callStreak = 1
		}

		if (this.callStreak >= CALL_REPEAT_THRESHOLD) {
			return {
				reason: "repeated-call",
				toolName,
				count: this.callStreak,
				message:
					`You have called ${toolName} with the exact same arguments ${this.callStreak} times in a row. ` +
					"Repeating it again will not produce a different result. Change your approach, or ask the developer what to do next.",
			}
		}
		return null
	}

	/**
	 * Call on a failed result, with the tool's own error text. Returns a verdict once the same
	 * tool has failed with the same error this many times running. A success, or a different
	 * error, resets the streak — see `observeSuccess`.
	 */
	observeFailure(toolName: string, errorText: string): LoopVerdict | null {
		const errorKey = errorText.trim()
		if (this.lastFailure && this.lastFailure.toolName === toolName && this.lastFailure.errorKey === errorKey) {
			this.failureStreak++
		} else {
			this.lastFailure = { toolName, errorKey }
			this.failureStreak = 1
		}

		if (this.failureStreak >= FAILURE_REPEAT_THRESHOLD) {
			return {
				reason: "repeated-failure",
				toolName,
				count: this.failureStreak,
				message:
					`${toolName} has failed with the same error ${this.failureStreak} times in a row: "${errorText.trim()}". ` +
					"Change your approach, or ask the developer what to do next.",
			}
		}
		return null
	}

	/** Call on a successful result so an old failure streak for that tool doesn't linger. */
	observeSuccess(toolName: string): void {
		if (this.lastFailure && this.lastFailure.toolName === toolName) {
			this.lastFailure = null
			this.failureStreak = 0
		}
	}
}
