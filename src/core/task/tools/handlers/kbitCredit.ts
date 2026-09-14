import { withLinks } from "@services/knowledge/kbit/people"
import type { BitProvenance as ResolverProvenance } from "@/services/knowledge/KnowledgeResolver"
import type { KbitCredit } from "@/services/knowledge/kbit/credit"

/**
 * One credit line per bit per task, from every path that serves a bit body.
 *
 * On 14 September a bit reached an answer through the read tool's path auto-correction — the agent
 * asked for a platform action under the product folder, and the one bit with that filename was served
 * below a note — and no credit line was said for it. The developer never saw who curated a bit that
 * shaped the answer. That branch simply had no call; the other two serving paths did. So the credit
 * lives here, deduplicated against the same per-task set the task's own prompt-credit uses, and every
 * serving path calls it: a bit is credited exactly once however many ways it reaches the agent.
 */

export type BitProvenance = ResolverProvenance

export interface CreditSink {
	taskState: { creditedKbits: Set<string> }
	callbacks: { say: (type: "kbit_loaded", text: string) => Promise<unknown> }
}

export async function creditBitOnce(config: CreditSink, credit: KbitCredit | null, source: BitProvenance): Promise<boolean> {
	if (!credit) {
		return false
	}
	if (config.taskState.creditedKbits.has(credit.id)) {
		return false
	}
	config.taskState.creditedKbits.add(credit.id)
	try {
		await config.callbacks.say(
			"kbit_loaded",
			JSON.stringify({
				id: credit.id,
				title: credit.title,
				kind: credit.kind,
				author: credit.author,
				attributed: credit.attributed,
				// Co-authors ride with the lead so the UI can credit them without a second lookup; omitted
				// when empty so the payload of a single-author bit is unchanged (older webviews ignore it).
				coAuthors: credit.coAuthors.length ? credit.coAuthors : undefined,
				// Profile links for the names on THIS line, resolved host-side — the webview has no network.
				links: withLinks(credit).links,
				version: credit.version,
				license: credit.license,
				platform: credit.platform,
				steward: credit.steward,
				source,
				// A witness is hardware evidence; the UI renders it as a labelled row, not prose. Absent
				// until a real run witnesses the bit — which is the honest state for nearly every bit today.
				witness: credit.witness
					? [credit.witness.board, credit.witness.toolchain, credit.witness.on].filter(Boolean).join(" · ")
					: undefined,
			}),
		)
	} catch {
		// attribution is additive — never surface as a tool failure
	}
	return true
}

/** What the auto-correct branch needs, injected so the branch can be tested without an editor. */
export interface NearMissDeps {
	loadBitByRel: (rel: string) => Promise<string | null>
	idForRel: (rel: string) => string | null
	creditFor: (id: string) => KbitCredit | null
	provenanceOf: (id: string) => BitProvenance | null | undefined
	markLoaded: (rel: string) => void
	track: (rel: string) => Promise<void>
}

/**
 * Serve the one catalog bit whose filename the agent asked for under the wrong folder — and credit it,
 * which this branch used not to. Returns the tool result, or null when the corrected bit would not load.
 */
export async function serveNearMissBit(
	config: CreditSink,
	requestedDisplay: string,
	correctedRel: string,
	deps: NearMissDeps,
): Promise<string | null> {
	const body = await deps.loadBitByRel(correctedRel)
	if (!body) {
		return null
	}
	deps.markLoaded(correctedRel)
	await deps.track(correctedRel)
	const id = deps.idForRel(correctedRel)
	if (id) {
		await creditBitOnce(config, deps.creditFor(id), deps.provenanceOf(id) || "downloaded")
	}
	return (
		`[Adsum knowledge bit — path auto-corrected. You asked for "${requestedDisplay}", which does not ` +
		`exist; the only catalog bit with that filename is "${correctedRel}", served below. Use ` +
		`"${correctedRel}" (exact) for any future read of this bit.]\n\n` +
		body
	)
}
