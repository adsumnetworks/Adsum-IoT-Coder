/**
 * What to say when a search over a captured log finds nothing.
 *
 * OBSERVED 2026-08-16 (task 1786842581519): the model did exactly what the doctrine asks — searched the
 * log directory for failure vocabulary first. The search legitimately matched nothing, because that
 * capture contained no errors. With nothing to go on, it then read whole log files, twice, which is the
 * behaviour search-before-read exists to prevent. Reported as "he did searchs, but didn't find with the
 * search, then he read it all 800 lines".
 *
 * "Found 0 results." is a true statement and a dead end. The recovery is not obvious from it: a log full
 * of healthy `<inf>` lines is not a log worth reading end to end, it is a log whose SHAPE should be
 * sampled — the distinct message kinds, then the lines around the interesting ones.
 *
 * This only fires for searches over captured logs, where reading the whole file is genuinely expensive
 * and a structural answer exists. A zero-result search over source code is left alone: there, "no
 * matches" is usually just the answer.
 */

/** Directory or file shapes the capture scripts produce (`logs/`, `logs/rtt/`, `logs/uart/`, …). */
const LOG_LOCATION = /(^|[\\/])logs?([\\/]|$)|\.(log|btmon)$/i

export function isLogSearchPath(searchPath: string | undefined): boolean {
	return !!searchPath && LOG_LOCATION.test(searchPath)
}

/**
 * Guidance appended to an empty result for a log search. Returns "" for anything else, so the caller
 * can concatenate unconditionally.
 */
export function emptyLogSearchGuidance(searchPath: string | undefined, regex: string | undefined): string {
	if (!isLogSearchPath(searchPath)) {
		return ""
	}
	const looksLikeFailureVocab = !!regex && /error|panic|assert|fault|LOG_ERR|fail|warn|WRN/i.test(regex)

	return (
		"\n\n[No match is a RESULT, not a dead end — do NOT now read the log end to end; that is the exact " +
		"cost this search exists to avoid.]\n" +
		(looksLikeFailureVocab
			? "Nothing failed in this capture, so the question is no longer 'what went wrong' but 'what did it " +
				"actually do'. Do not scan for the answer by eye.\n"
			: "That term is absent from the capture. Before assuming it never happened, check you are searching " +
				"the right capture and the right spelling — logs use the module's own wording.\n") +
		"Next, in this order:\n" +
		"1. Establish the log's SHAPE first: search for the module tag or level markers actually present " +
		'(e.g. "<err>|<wrn>|<inf>" or "<your_module>:") to see which message kinds exist and how often.\n' +
		"2. Search for the DOMAIN event you care about in the log's own vocabulary — the words the firmware " +
		'prints, not the words in the ticket (e.g. "SEEN|MATCH|Connected|Disconnected|adv|scan").\n' +
		"3. Only then read_file with start_line/end_line around a specific hit, plus the first ~40 lines for " +
		"the boot banner if you still need configuration.\n" +
		"If two searches in a row find nothing, say so and ask what the developer expected to see — that is " +
		"cheaper and more honest than reading thousands of lines hoping something stands out."
	)
}
