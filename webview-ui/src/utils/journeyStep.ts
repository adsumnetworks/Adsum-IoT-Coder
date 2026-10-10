import type { ClineMessage } from "@shared/ExtensionMessage"

export interface JourneyStep {
	step: number
	total: number
}

/** `### Step 3/7`, `### step 3 / 7` — the heading a journey k-bit's prompt is written to emit. */
const STEP_HEADING = /^#{1,6}\s*step\s+(\d+)\s*\/\s*(\d+)\b/im

/**
 * The journey step banner's source fact: the most recent `### Step N/M` heading in the LATEST assistant
 * text message. Only the latest is read — a step heading from three turns ago is stale, not current — and
 * only a real text say counts, never a tool/ask/system row.
 */
export function findJourneyStep(messages: ClineMessage[]): JourneyStep | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (m.type !== "say" || m.say !== "text" || !m.text) {
			continue
		}
		const match = STEP_HEADING.exec(m.text)
		if (match) {
			const step = Number(match[1])
			const total = Number(match[2])
			if (Number.isFinite(step) && Number.isFinite(total) && total > 0) {
				return { step, total }
			}
		}
		// The latest text message is the only one consulted — if it carries no heading, there is no
		// current step, even if an earlier turn had one.
		return undefined
	}
	return undefined
}
