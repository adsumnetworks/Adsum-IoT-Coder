/**
 * Deciding whether an end-of-command event belongs to the command we sent.
 *
 * Extracted from VscodeTerminalProcess so it can be tested: the listener there runs against live vscode
 * objects inside a real extension host, and every rule below was originally arrived at by watching a
 * driven run stall and reading breadcrumbs out of the extension log.
 *
 * What makes this hard is that none of the three signals VS Code offers is reliable on its own:
 *
 *  - REFERENCE. `e.execution === execution` is the truth when it holds, and it frequently does not: the
 *    object arrives through the extension-host API layer as a different wrapper.
 *  - COMMAND LINE. Removed, see `commandLineIsUnreliable` below.
 *  - SEQUENCE. VS Code serialises shell executions per terminal, so after our start event the next end on
 *    our terminal is ours. True for a single command; not true for a compound one.
 */

export interface EndEventFacts {
	/** The event's execution object is the very one executeCommand returned. */
	byRef: boolean
	/** The event is on the terminal we are using. */
	sameTerminal: boolean
	/** Our own start event has already been seen, so any earlier end belonged to a previous command. */
	sawOurStart: boolean
	/** The command we sent contains more than one shell command. */
	isCompound: boolean
}

export type EndDecision =
	| { accept: true; why: "reference" | "sequence" }
	| { accept: false; why: "stale" | "other-terminal" | "compound-subcommand" }

/**
 * WHY THE COMMAND LINE IS NOT CONSULTED.
 *
 * VS Code fills `execution.commandLine.value` from the shell's own OSC 633;E marker, which the shell
 * integration script derives from shell history. On a machine where history is shared between sessions,
 * that is somebody else's command. Observed 2026-08-29: an end event on the extension's terminal arrived
 * reporting `theirCmd=kill 1011298` — a command typed in an unrelated ssh session minutes earlier. It has
 * also been seen alias-expanded (`ls` arriving as `ls --color=auto`), so even an honest match can fail.
 *
 * A signal that is wrong in both directions is not a fast path, it is a coin toss, and it was the reason
 * a genuine end event was once rejected while a foreign one was nearly accepted.
 */
export const commandLineIsUnreliable = true

/** `;`, `&&`, `||`, or a newline — anything that makes the shell run more than one command. */
export function isCompoundCommand(command: string): boolean {
	// Deliberately crude. A `;` inside a quoted string would be a false positive, and the cost of that is
	// falling back to reference-matching plus the silence backstop — slower, never wrong. The cost of a
	// false NEGATIVE is accepting a sub-command's end as the whole command's, which truncates real output.
	return /[\n;]|&&|\|\|/.test(command)
}

export function endEventDecision(facts: EndEventFacts): EndDecision {
	if (facts.byRef) {
		// Identity beats everything, including the compound rule: this IS our execution ending.
		return { accept: true, why: "reference" }
	}
	if (!facts.sameTerminal) {
		return { accept: false, why: "other-terminal" }
	}
	if (!facts.sawOurStart) {
		// A previous command's end, arriving in the milliseconds after we sent ours. VS Code serialises
		// executions per terminal, so anything before our own start belongs to what came before.
		return { accept: false, why: "stale" }
	}
	if (facts.isCompound) {
		// SEQUENCE CANNOT BE TRUSTED HERE, and pretending otherwise truncates output.
		//
		// Shell integration reports start/end per SUB-command. On 2026-08-29 `echo "si 1" > f; echo …;
		// JLinkExe …` produced a start for `echo "si 1"` and an end for it, and the sequence rule accepted
		// that first end as the whole command's — so the run moved on while JLinkExe was still going.
		//
		// There is no way to tell from the API how many sub-commands are coming, so this does not guess.
		// A compound command completes on reference identity, or on the silence backstop that bounds every
		// command anyway. Slower in the case where reference matching fails; never wrong.
		return { accept: false, why: "compound-subcommand" }
	}
	return { accept: true, why: "sequence" }
}
