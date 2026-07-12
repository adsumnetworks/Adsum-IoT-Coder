/**
 * Resting-ask option guards (pure — unit-tested in restingAskGuards.test.ts; craArtifact.test.ts is a suite
 * neighbour). Generalized from the CRA-only `craAskGuards.ts` — the regexes below never depended on CRA
 * content, only on English option phrasing, so the guard applies to ANY resting workflow (gated host-side on
 * `TaskState.restingWorkflowActive`, not on a CRA-specific flag). CRA is the first, and today the only,
 * workflow that sets that flag.
 *
 * A resting workflow has no ending (generalized core rule): the session rests on an open ask_followup_question
 * whose options are FORWARD moves the AGENT takes next. Two option shapes defeat that and are rejected:
 *
 * 1. EXIT-shaped — terminal ("I'm done", "that's all") or pause ("I'll continue later", "Save & come back").
 *    A real CRA run offered "I'll continue later"; clicking it ended the session.
 * 2. DEV-HANDBACK-shaped — first-person-developer phrasings that hand the ball back and park the run
 *    ("I'll review the report myself", "I'll continue from the report", "I'll take it from here"). A real
 *    open-project run offered exactly those two; both are dead ends dressed as choices. The developer can
 *    ALWAYS read the report or walk away without a button — spending an option on it only invites leaving.
 *    Structural discriminator: the option's ACTOR. Agent-led options are verb-first imperatives ("Start …",
 *    "Triage …", "Re-scan …", "Draft a VEX …"); a handback starts with the developer as subject ("I'll …",
 *    "I will …", "I've got …", "Leave it with me").
 */

/** Terminal or pause session-exit phrasings. Kept tight to true exits so per-thread declines never trip. */
export const RESTING_EXIT_OPTION_RE =
	/\b(i'?ll (continue|come back( to (this|it))?) later|come back later|i'?m (all )?done|that'?s (all|it)( for (now|today))?|wrap (it |this )?up|review (it |this )?offline|done for (now|today|the day)|end (the |this )?(run|session|task|chat)|close (the |this )?(run|session|task)|nothing else (for now|right now|today)|maybe later|not right now)\b/i

/** Developer-as-actor option openers — the handback shape. Anchored to the option START so agent-led options
 *  that merely mention the dev mid-sentence ("Re-scan after you change the config") never trip. */
export const RESTING_DEV_HANDBACK_RE =
	/^\s*["'“”]?\s*(i['’]?ll\b|i will\b|i['’]?ve\b|i['’]?d rather\b|i can (take|handle)\b|leave (it|this) (with|to) me\b|i(['’]?m| am) going to\b|let me (review|read|take|handle)\b)/i

export type RestingOptionViolation = { option: string; kind: "exit" | "handback" }

/** Scan a resting workflow's ask's options; returns every violation (empty = clean). */
export function findRestingOptionViolations(options: string[]): RestingOptionViolation[] {
	const violations: RestingOptionViolation[] = []
	for (const option of options) {
		if (RESTING_EXIT_OPTION_RE.test(option)) {
			violations.push({ option, kind: "exit" })
		} else if (RESTING_DEV_HANDBACK_RE.test(option)) {
			violations.push({ option, kind: "handback" })
		}
	}
	return violations
}

/**
 * Demo-completion detector (telemetry): the no-ending demos (cra-sample, hci-sniffer) never call
 * attempt_completion, so `free_tier.demo_run_completed` fires when the demo reaches its CLOSING resting ask.
 * The closing offers "run this on my own project" / "check my own project" / the CRA-check / "open your
 * project". CAREFUL: the HCI beat exit-ramp "Point Adsum at my own project" (offered from Beat 3 on) also
 * mentions "my own project" — it must NOT count as the closing, or completion fires at the reveal. So we
 * match the closing-specific phrasings and deliberately EXCLUDE the bare "point … at my own project" ramp.
 * Scoped to the two named free-tier demo scripts (not part of the generalized resting-ask mechanism above —
 * a future no-ending demo adds its own closing phrasing here, same as CRA/HCI did).
 */
const DEMO_CLOSING_RE =
	/\b(run this on my own|check my own project|check this build against the eu cra|ship[- ]ready|open your (own )?project|want this on your)\b/i
const DEMO_EXIT_RAMP_RE = /point\s+adsum\s+at\s+my\s+own/i

/** True iff this ask's options are a no-ending demo's CLOSING menu (not a mid-run beat + its exit ramp). */
export function isDemoClosingAsk(options: string[]): boolean {
	return options.some((o) => DEMO_CLOSING_RE.test(o) && !DEMO_EXIT_RAMP_RE.test(o))
}
