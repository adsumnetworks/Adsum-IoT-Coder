import type { ClineStorageMessage } from "@/shared/messages/content"
import { renderTailBlock, TAIL_BEGIN, TAIL_END } from "./render"
import { readSession, readStatus } from "./store"

/**
 * Tier B — the volatile half of project memory.
 *
 * Rendered by host code onto the LAST user message of every request, downstream of the prompt
 * cache breakpoint. Two reasons it lives here and not in the system prompt:
 *
 *  1. COST/LATENCY. The system prompt is the cached prefix (~46K tokens). Anything that changes
 *     mid-task and lives in there forces a full re-process on the next turn. Defects and focus
 *     change constantly, so they must sit after the breakpoint.
 *
 *  2. ATTENTION. Measured sessions ran 45-212 turns — squarely the "lost in the middle" regime.
 *     Reciting the goal and the open defect near the END of the context is where models attend
 *     best, which is exactly the failure the founder described: "after auto-compact it follows
 *     the latest prompts but lost the context."
 *
 * The block is regenerated from disk each turn and the previous one is stripped first, so it can
 * never accumulate and the model always sees exactly one, current copy.
 */

/** Remove any previously-injected block so exactly one (current) copy is ever present. */
export function stripTailBlock(text: string): string {
	const start = text.indexOf(TAIL_BEGIN)
	if (start < 0) {
		return text
	}
	const endIdx = text.indexOf(TAIL_END, start)
	const end = endIdx < 0 ? text.length : endIdx + TAIL_END.length
	return (text.slice(0, start) + text.slice(end)).trimEnd()
}

/**
 * Append the current project state to the final user message.
 *
 * Returns the history unchanged when there is nothing to say, so a project with no memory yet
 * pays literally nothing. Fail-open: any error returns the input untouched — memory must never
 * be able to break a request.
 */
export function withProjectStateTail(history: ClineStorageMessage[], cwd: string | undefined): ClineStorageMessage[] {
	try {
		if (!cwd || history.length === 0) {
			return history
		}
		const block = renderTailBlock(readStatus(cwd), readSession(cwd))
		if (!block.trim()) {
			return history
		}

		// Find the last user message; tool results are user-role too, which is fine — the tail
		// belongs on whatever the model reads last.
		let idx = -1
		for (let i = history.length - 1; i >= 0; i--) {
			if (history[i].role === "user") {
				idx = i
				break
			}
		}
		if (idx < 0) {
			return history
		}

		const target = history[idx]
		const content = target.content
		const out = [...history]

		if (typeof content === "string") {
			out[idx] = { ...target, content: `${stripTailBlock(content)}\n\n${block}` }
			return out
		}
		if (!Array.isArray(content)) {
			return history
		}

		// Attach to the last text block if there is one; otherwise add a text block. Never touch
		// tool_result or image blocks — rewriting those would corrupt the tool protocol.
		const blocks = content.map((b) => ({ ...b }))
		let lastText = -1
		for (let i = blocks.length - 1; i >= 0; i--) {
			if ((blocks[i] as { type?: string }).type === "text") {
				lastText = i
				break
			}
		}
		if (lastText >= 0) {
			const b = blocks[lastText] as { type: "text"; text: string }
			b.text = `${stripTailBlock(b.text)}\n\n${block}`
		} else {
			blocks.push({ type: "text", text: block } as never)
		}
		out[idx] = { ...target, content: blocks as typeof content }
		return out
	} catch {
		return history
	}
}
