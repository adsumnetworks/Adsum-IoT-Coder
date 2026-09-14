/**
 * What the developer is told when a knowledge bit will not load.
 *
 * A pure function, and its own file, because the wording is the product here: the released build
 * told a developer a bit they simply had no entitlement to "is not bundled and not in the registry",
 * then advised them to publish it to our registry and to set a developer environment variable. Three
 * of those four things are ours and not theirs, and the first is false — the bit exists; it is not
 * open to that account. A message with that much of our machinery in it cannot be reviewed inside a
 * 200-line tool handler, and it cannot be tested there either. Here it can be both.
 */

export type KbitUnavailableReason =
	/** The registry answered 402: the bit is real and is not this account's yet. */
	| "locked"
	/** The registry answered, and has no such bit. */
	| "not-in-registry"
	/** We could not reach the registry at all. */
	| "unreachable"

/**
 * Which failure the read tool is looking at, decided in one place.
 *
 * Locked is checked FIRST. A bit the manifest lists and the blob route then refuses with 402 is also
 * "listed but the fetch failed", and answering that as a transient blip tells the agent to retry a
 * refusal that will never change. `null` means a transient fetch failure: retry once.
 */
export function unavailableReason(f: { locked: boolean; reachable: boolean; listed: boolean }): KbitUnavailableReason | null {
	if (f.locked) return "locked"
	if (!f.reachable) return "unreachable"
	return f.listed ? null : "not-in-registry"
}

/**
 * What the read tool says when a bit would not load after the near-miss rescue, decided in one place.
 *
 * [14 Sep 2026, B8] A developer on a free account followed an index row to a bit their account cannot
 * open, by a path that was one folder off. The rescue found the right path, could not serve it (it is
 * locked), and the refusal then said BOTH "could not open this for your account" and "a file with this
 * name exists at a different path — you likely mis-derived the directory". The agent spent a turn on the
 * contradiction and went looking for a path it could never open. So: a lock is said alone, and a path
 * the account cannot open is never offered as a hint. A genuine near miss on an open bit keeps its hint.
 */
export function refusalAfterNearMiss(f: {
	/** The id the agent asked for is known to be locked for this account. */
	requestedLocked: boolean
	reachable: boolean
	/** Same-filename bits elsewhere in the catalogue, each with whether this account is locked out of it. */
	nearMisses: Array<{ rel: string; locked: boolean }>
}): { reason: KbitUnavailableReason; pathHint: string } {
	const open = f.nearMisses.filter((m) => !m.locked)
	if (f.requestedLocked || (f.nearMisses.length > 0 && open.length === 0)) {
		return { reason: "locked", pathHint: "" }
	}
	if (!f.reachable) {
		return { reason: "unreachable", pathHint: "" }
	}
	if (open.length > 0) {
		return {
			reason: "not-in-registry",
			pathHint:
				`A bit with this FILENAME exists at a different path — you likely mis-derived the directory. ` +
				`Retry with the exact path: ${open.map((m) => m.rel).join("  or  ")}. `,
		}
	}
	return {
		reason: "not-in-registry",
		pathHint: `First re-check the path (combine the iot-knowledge directory with the bit's relative path). `,
	}
}

export interface KbitUnavailableInput {
	reason: KbitUnavailableReason
	/** What the agent asked for, as it asked for it. Never an id, hash or size of a locked bit. */
	displayPath: string
	/** The nearest-path advice, when there is one. Empty for a locked bit — the path was right. */
	pathHint?: string
	/** The rule that stops an unavailable bit becoming an invented one. */
	antiImprovise: string
	/** Developer builds only. A customer must never be handed an environment variable. */
	isDev?: boolean
	/**
	 * What kind of bit it is. Only a WORKFLOW the task depends on ends the answer when it is locked: without it
	 * there is no procedure to follow. A locked knowledge or tool bit is one missing ingredient, and the answer
	 * goes on without it (B12). Absent ⇒ judged from `displayPath`.
	 */
	kind?: "workflow" | "knowledge" | "tool"
}

/** A bit's kind from the path the agent asked for: `…/workflows/…` and `…/tools/…` say so; the rest is knowledge. */
export function kindFromPath(p: string): "workflow" | "knowledge" | "tool" {
	const norm = p.replace(/\\/g, "/")
	if (/(^|\/)workflows\//.test(norm)) return "workflow"
	if (/(^|\/)tools\//.test(norm)) return "tool"
	return "knowledge"
}

/** The developer-facing sentence for a bit that is real and not theirs yet. */
const LOCKED =
	"This knowledge bit is not open to your account. Sets like this one are opened on request — " +
	"tell the developer they can ask for more details from the Adsum panel, and that nothing on this " +
	"machine is broken."

/**
 * [14 Sep 2026, B12, B14] What follows the lock sentence for a locked knowledge or tool bit. B14: "carry on
 * with the bits that did open" was read as permission to fill the locked topic from general knowledge — an agent
 * refused the satellite bits and then wrote a satellite attach sequence, with settings, from memory. The workflow wording
 * ("tell the developer the workflow is currently unavailable and stop") used to follow every lock, so one
 * locked satellite bit ended a whole answer and the free board bit that had loaded said nothing.
 */
/**
 * For a locked WORKFLOW. It ends the answer only when the developer's request needs that workflow. On
 * 14 September a developer asked how to flash a part; the agent also tried the first-run workflow, was told
 * "tell the developer the workflow is currently unavailable and stop", and stopped — with the programming
 * steps it had already loaded unsaid.
 */
const LOCKED_WORKFLOW =
	" Do not reconstruct or improvise this workflow from general knowledge, memory or a prior report. If the " +
	"developer's request cannot be answered without it, tell them the workflow is currently unavailable and stop. " +
	"If it can, answer from the bits that did open and do not mention this workflow again."

const LOCKED_CARRY_ON =
	" Do not invent what it contains. For the topic this bit covers, give no procedure, command, setting or " +
	"value from general knowledge — not even one you are confident of: the developer would act on it. Answer " +
	"only with what the bits that did open and the developer's own project actually state. Tell the developer, " +
	'in these words: "The detailed steps for this are in a set that isn\'t open to your account."'

export function kbitUnavailableMessage({
	reason,
	displayPath,
	pathHint = "",
	antiImprovise,
	isDev = false,
	kind,
}: KbitUnavailableInput): string {
	if (reason === "locked") {
		// No id, no hash, no size, no group name: none of that is the developer's business, and a
		// number attached to a thing you cannot have reads as a tease.
		return (kind ?? kindFromPath(displayPath)) === "workflow" ? `${LOCKED}${LOCKED_WORKFLOW}` : `${LOCKED}${LOCKED_CARRY_ON}`
	}
	if (reason === "unreachable") {
		return (
			`Could not load knowledge bit "${displayPath}": the Adsum knowledge registry is unreachable ` +
			`and this bit is not cached locally. Check your network connection and retry.${antiImprovise} ` +
			`(Bundled knowledge is unaffected.)`
		)
	}
	/*
	 * Not in the registry. Even here the old wording was wrong for the person reading it: the client
	 * cannot yet tell "no such bit" from "not yours" for anything the manifest omits, so a flat "it
	 * does not exist" states as fact the one thing we do not know. It says what we DO know, offers the
	 * same door, and keeps the developer hint for developer builds only.
	 */
	const devHint = isDev ? " (Dev build: set ADSUM_KBIT_LOCAL to load downloaded bits from disk.)" : ""
	return (
		`Adsum could not open the knowledge bit "${displayPath}" for this account. ${pathHint}` +
		`If the path is right, this one is not open to your account — some sets are opened on request, ` +
		`and the developer can ask for more details from the Adsum panel.${antiImprovise}${devHint}`
	)
}
