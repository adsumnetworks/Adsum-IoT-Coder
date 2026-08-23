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
		version: tool.version,
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

/**
 * Credit a tool bit the NATIVE handlers run.
 *
 * `triggerNordicAction` and `triggerEspAction` resolve their logger through `ToolResolver.pathOf()`
 * and spawn it themselves — they never go through `execute_command`, so the credit hook there never
 * fires. Without this a bundled tool run by a handler is silently uncredited, which is exactly the
 * failure the credit line exists to prevent, and it was invisible until a real ESP capture went
 * through the handler path rather than the shell.
 *
 * Same once-per-task rule and the same fail-open contract: attribution must never break a capture.
 */
// `config` is the handler's TaskConfig; typed loosely for the same reason sayKbitCredit is — the
// credit path only ever needs `ulid` and `callbacks.say`, and pinning the full type here would couple
// attribution to the task-config shape.
// biome-ignore lint/suspicious/noExplicitAny: only ulid + callbacks.say are used
export async function creditToolById(config: any, toolId: string, resolved?: ResolvedTool): Promise<void> {
	try {
		// Credit the copy that ACTUALLY ran. Re-resolving from the bundled tree would name the VSIX
		// author, licence and version even when the registry copy is what executed — and after a
		// co-author or licence change, that is not a cosmetic difference.
		let tool = resolved
		if (!tool) {
			const { loadBundledTools } = await import("./ToolResolver")
			tool = loadBundledTools().find((t) => t.id === toolId)
		}
		if (!tool || !shouldCreditTool(config.ulid, tool.id)) {
			return
		}
		const credit = creditForTool(tool)
		await config.callbacks.say(
			"kbit_loaded",
			JSON.stringify({
				id: credit.id,
				title: credit.title,
				kind: credit.kind,
				author: credit.author,
				attributed: credit.attributed,
				coAuthors: credit.coAuthors.length ? credit.coAuthors : undefined,
				version: credit.version,
				license: credit.license,
				platform: credit.platform,
				steward: credit.steward,
				source: tool.provenance,
			}),
		)
	} catch {
		// additive — never surface as a tool failure
	}
}
