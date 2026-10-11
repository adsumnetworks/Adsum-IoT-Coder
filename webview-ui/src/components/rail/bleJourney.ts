import { type Blg20Commission, type Blg20Unit, blg20Passkey } from "@shared/blg20"

/**
 * [11 Oct 2026] The journey the Hardware page runs on a gateway over Bluetooth before any session, as the operator
 * put it: detect it, connect and pair, claim it, check its firmware, and propose the upgrade when the latest is newer.
 * Pure: one row of steps from the unit's facts, so every state is tested and the component only draws.
 */
export interface JourneyStep {
	id: "connect" | "claim" | "firmware" | "commission"
	/** The fact, when the step is done: "paired · Bluetooth half 0.3.6, cellular half 0.2.8". */
	done?: string
	/** The action to offer, when the step is next: "Connect", "Claim", "Check firmware". */
	action?: string
	/** A step that cannot run yet says why in a few words. */
	blocked?: string
	/** Linux only: the first connection takes the six digits; the demo firmware's are derived, so the host fills them. */
	needsPasskey?: boolean
	/** macOS and Windows: the computer's dialog asks; these are the demo firmware's digits to type there. */
	passkeyHint?: string
	/** The long facts behind the step's (i): the unit's own line, its verdict, its window. */
	info?: string
	/** The step's action is the next thing to do although the step has a fact (a unit read and not commissioned). */
	primary?: boolean
}

/** The commissioning step's short words: the state and the unit's own verdict, so the line fits a narrow rail. */
export function commissionWords(c: Blg20Commission): string {
	if (!c.commissioned) return "not commissioned"
	const v = c.verdict?.state
	return v === "go"
		? "commissioned · working"
		: v === "stop"
			? "commissioned · not working yet"
			: v === "warn"
				? "commissioned · still checking"
				: "commissioned"
}

export function journeySteps(u: Blg20Unit, platform?: string): JourneyStep[] {
	const steps: JourneyStep[] = []
	const paired = u.paired === true
	if (paired) {
		steps.push({ id: "connect", done: `paired · Bluetooth half ${u.bleFw ?? "?"}, cellular half ${u.lteFw ?? "?"}` })
	} else if (u.windowOpen === false) {
		steps.push({ id: "connect", action: "Connect", blocked: "window closed: hold its button for three seconds, then scan" })
	} else if (platform === "linux") {
		steps.push({ id: "connect", action: "Connect", needsPasskey: false })
	} else {
		const digits = u.bleId ? blg20Passkey(u.bleId) : undefined
		steps.push({
			id: "connect",
			action: "Connect",
			needsPasskey: false,
			...(digits && u.bonded !== true ? { passkeyHint: `the computer asks to pair: type ${digits} (DEMO firmware)` } : {}),
		})
	}
	if (!paired) {
		return steps
	}
	if (u.claimed) {
		steps.push({
			id: "claim",
			done: u.mine ? "claimed by this computer" : "claimed by another computer's key",
			...(u.mine ? {} : { blocked: "that computer releases it (owner-clear), or the unit's ten-second button wipe does" }),
		})
	} else {
		steps.push({ id: "claim", action: "Claim" })
	}
	if (u.latest) {
		const l = u.latest
		steps.push({
			id: "firmware",
			done: l.newer
				? `newer available: v${l.version} (Bluetooth half ${l.bleFw ?? "?"}, cellular half ${l.lteFw ?? "?"}): Flash v${l.version} over Bluetooth below`
				: l.ahead
					? `runs a newer build than the latest release v${l.version} (Bluetooth half ${l.bleFw ?? "?"}, cellular half ${l.lteFw ?? "?"})`
					: l.bleFw
						? `up to date: v${l.version} is what it runs`
						: `latest listed: v${l.version}`,
			action: "Check again",
		})
	} else {
		steps.push({ id: "firmware", action: "Check firmware" })
	}
	// [11 Oct 2026] The fourth step: what the unit holds as commissioned, read on the same link as the passport, and one
	// action that opens a session (the conversation is the form). It needs no claim: the commissioner's characteristics
	// answer any paired computer.
	const c = u.commission
	if (!c) {
		steps.push({ id: "commission", action: "Commission it" })
	} else {
		steps.push({
			id: "commission",
			done: commissionWords(c),
			action: c.commissioned ? "Change…" : "Commission it",
			...(c.commissioned ? {} : { primary: true }),
			info: [c.line, c.verdict?.words, c.window ? `Window: ${c.window}.` : ""].filter(Boolean).join(" "),
		})
	}
	return steps
}

/** The row's own line: "LBG20x AD50 · -59 dBm · window open · paired". */
export function rowWords(u: Blg20Unit): string {
	const parts: string[] = []
	if (typeof u.rssi === "number") parts.push(`${u.rssi} dBm`)
	parts.push(u.windowOpen === false ? "window closed" : "window open")
	if (u.paired === true || u.bonded === true) parts.push("paired")
	else if (u.bonded === false) parts.push("not paired yet")
	return parts.join(" · ")
}

/** Six digits, as the label prints them; anything else is not a passkey. */
export const isPasskey = (s: string) => /^\d{6}$/.test(s.trim())
