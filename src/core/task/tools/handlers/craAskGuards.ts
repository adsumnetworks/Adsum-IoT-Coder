/**
 * CRA resting-ask option guards (pure — unit-tested in craArtifact.test.ts's suite neighbour craAskGuards.test.ts).
 *
 * A CRA run has no ending (core rule 8): the session rests on an open ask_followup_question whose options are
 * FORWARD moves the AGENT takes next. Two option shapes defeat that and are rejected:
 *
 * 1. EXIT-shaped — terminal ("I'm done", "that's all") or pause ("I'll continue later", "Save & come back").
 *    A real run offered "I'll continue later"; clicking it ended the session.
 * 2. DEV-HANDBACK-shaped — first-person-developer phrasings that hand the ball back and park the run
 *    ("I'll review the report myself", "I'll continue from the report", "I'll take it from here"). A real
 *    open-project run offered exactly those two; both are dead ends dressed as choices. The developer can
 *    ALWAYS read the report or walk away without a button — spending an option on it only invites leaving.
 *    Structural discriminator: the option's ACTOR. Agent-led options are verb-first imperatives ("Start …",
 *    "Triage …", "Re-scan …", "Draft a VEX …"); a handback starts with the developer as subject ("I'll …",
 *    "I will …", "I've got …", "Leave it with me").
 */

/** Terminal or pause session-exit phrasings. Kept tight to true exits so per-thread declines never trip. */
export const CRA_EXIT_OPTION_RE =
	/\b(i'?ll (continue|come back( to (this|it))?) later|come back later|i'?m (all )?done|that'?s (all|it)( for (now|today))?|wrap (it |this )?up|review (it |this )?offline|done for (now|today|the day)|end (the |this )?(run|session|task|chat)|close (the |this )?(run|session|task)|nothing else (for now|right now|today)|maybe later|not right now)\b/i

/** Developer-as-actor option openers — the handback shape. Anchored to the option START so agent-led options
 *  that merely mention the dev mid-sentence ("Re-scan after you change the config") never trip. */
export const CRA_DEV_HANDBACK_RE =
	/^\s*["'“”]?\s*(i['’]?ll\b|i will\b|i['’]?ve\b|i['’]?d rather\b|i can (take|handle)\b|leave (it|this) (with|to) me\b|i(['’]?m| am) going to\b|let me (review|read|take|handle)\b)/i

export type CraOptionViolation = { option: string; kind: "exit" | "handback" }

/** Scan a CRA resting-ask's options; returns every violation (empty = clean). */
export function findCraOptionViolations(options: string[]): CraOptionViolation[] {
	const violations: CraOptionViolation[] = []
	for (const option of options) {
		if (CRA_EXIT_OPTION_RE.test(option)) {
			violations.push({ option, kind: "exit" })
		} else if (CRA_DEV_HANDBACK_RE.test(option)) {
			violations.push({ option, kind: "handback" })
		}
	}
	return violations
}
