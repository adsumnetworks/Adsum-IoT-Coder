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
}

/** The developer-facing sentence for a bit that is real and not theirs yet. */
const LOCKED =
	"This knowledge bit is not open to your account. Sets like this one are opened on request — " +
	"tell the developer they can ask for more details from the Adsum panel, and that nothing on this " +
	"machine is broken."

export function kbitUnavailableMessage({
	reason,
	displayPath,
	pathHint = "",
	antiImprovise,
	isDev = false,
}: KbitUnavailableInput): string {
	if (reason === "locked") {
		// No id, no hash, no size, no group name: none of that is the developer's business, and a
		// number attached to a thing you cannot have reads as a tease.
		return `${LOCKED}${antiImprovise}`
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
