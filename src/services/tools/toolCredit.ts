import { creditFromMeta, type KbitCredit } from "@/services/knowledge/kbit/credit"
import type { ResolvedTool } from "./ToolResolver"

/**
 * Credit for a tool bit, on the same terms as a knowledge bit.
 *
 * Tool bits are authored and co-authored by Adsum and by others, and the attribution facts live in
 * the bit's own frontmatter — never in a host-side id→person table. So this reuses creditFromMeta
 * rather than inventing a parallel path; `kind: "tool"` is what makes the UI render the ⚙ mark.
 */
export function creditForTool(tool: ResolvedTool): KbitCredit {
	return creditFromMeta({
		id: tool.id,
		title: tool.name,
		type: "tool",
		author: tool.author,
		license: tool.license,
		platform: tool.platform,
		co_authors: tool.coAuthors?.map((name) => ({ name })),
	} as Parameters<typeof creditFromMeta>[0])
}

/**
 * Which resolved tool, if any, a shell command is invoking.
 *
 * Matching is on the tool's rendered command prefix appearing at the start of the command line —
 * the same string the prompt advertised — with quotes tolerated because the advertisement quotes
 * paths containing spaces and the model may echo them either way. Longest match wins so a tool whose
 * name prefixes another's cannot steal the credit.
 */
export function toolForCommand(command: string, tools: ResolvedTool[]): ResolvedTool | null {
	const normalise = (s: string) => s.replace(/["']/g, "").trim()
	const line = normalise(command)
	let best: ResolvedTool | null = null
	for (const t of tools) {
		if (!t.command) {
			continue
		}
		const prefix = normalise(t.command)
		if (line === prefix || line.startsWith(`${prefix} `)) {
			if (!best || prefix.length > normalise(best.command).length) {
				best = t
			}
		}
	}
	return best
}

/** Per-task memory of which tools have already been credited — one credit line per tool per task. */
const creditedByTask = new Map<string, Set<string>>()

export function shouldCreditTool(taskId: string, toolId: string): boolean {
	let seen = creditedByTask.get(taskId)
	if (!seen) {
		seen = new Set()
		creditedByTask.set(taskId, seen)
		// Bound the map: a long-lived host should not accumulate a set per task forever.
		if (creditedByTask.size > 50) {
			const oldest = creditedByTask.keys().next().value
			if (oldest !== undefined && oldest !== taskId) {
				creditedByTask.delete(oldest)
			}
		}
	}
	if (seen.has(toolId)) {
		return false
	}
	seen.add(toolId)
	return true
}

/** Test seam. */
export function resetToolCredits(): void {
	creditedByTask.clear()
}
