/**
 * CRA honesty scan (readiness-not-compliance) — a HIGH-PRECISION static guard against verdict-word leaks
 * in **generated** CRA output (a written `compliance/*.md` report, or an offer / closing-summary string).
 *
 * Scope + honest limits (read before trusting this):
 * - It targets the **documented leak shapes** (the failures the project actually hit): a ✅ glued to a
 *   verdict, "now compliant", "gap/vuln fixed/resolved", "you're affected/clear", "Top gap fixed",
 *   "status: ✅/fixed". It is a **safety net, not a guarantee** — it will NOT catch a paraphrased verdict
 *   ("your firmware satisfies the requirement"). The load-bearing honesty guards remain the bit rules
 *   (evidence-mode, verify-the-positive-AND-negative) — this only catches the literal leaks.
 * - It is **high-precision by design**: it skips negated / meta uses so it does not fire on the CRA
 *   disclaimer itself ("NOT a conformity assessment", "✅ means configured, never compliant/correct/done",
 *   "I will never tell you you're clear", "not affected"). Run it over GENERATED reports + offer/summary
 *   strings — not over the bit SOURCES (which legitimately quote the banned words in their rules).
 *
 * Intended use: CI / the eval harness (scan generated fixtures). NOT a runtime write blocker (that would
 * false-positive on disclaimers and is too heavy). See design/06 + design/07 + the red-team MF4.
 */

/** The permanent-ban verdict vocabulary (never attributable to anyone): readiness-not-compliance. */
export const VERDICT_TERMS = ["compliant", "certified", "passes", "affected", "fixed", "done", "resolved", "clear"] as const

export interface VerdictLeak {
	/** 1-based line number within the scanned content. */
	line: number
	/** The exact substring that tripped the rule. */
	match: string
	/** Which leak pattern fired (for triage). */
	rule: string
}

/**
 * A refusal verb + a speech/judgement verb on the same line = a META / limit statement, not a verdict
 * ("I will **never tell** you you're clear", "this **won't say** you're compliant", "we **do not claim**
 * it's fixed"). Bare negation is NOT enough — "your build is **not** affected" is still a (banned) verdict.
 * Lines with this cue are skipped wholesale (a genuine report leak never sits on a "never say…" line).
 */
const LIMIT_STATEMENT =
	/\b(?:never|won'?t|will\s+not|do(?:es)?\s*n'?t|do(?:es)?\s+not|cannot|can'?t|refuses?\s+to|refrain(?:s|ed)?)\s+(?:to\s+)?(?:tell|say|saying|says|claim|assert|call|mark|grade|state|report|label|imply|conclude|promise|guarantee)\b/i

interface LeakPattern {
	rule: string
	re: RegExp
}

/** High-precision leak patterns — each targets an *assertive* verdict shape, not a bare word. */
const LEAK_PATTERNS: LeakPattern[] = [
	// A ✅/✔ glued to a verdict — the canonical "✅ FIXED" leak.
	{ rule: "glyph-verdict", re: /[✅✔]\s*(fixed|done|resolved|pass(?:es|ed)?|compliant|certified|clear)\b/gi },
	// "now/fully compliant|resolved|fixed|done|cleared"
	{ rule: "now-verdict", re: /\b(?:now|fully|now fully)\s+(compliant|certified|resolved|fixed|done|cleared|clear)\b/gi },
	// Assertive subject + verdict: "you're compliant", "the build is certified", "product is compliant"
	{
		rule: "assertive-verdict",
		re: /\b(?:you(?:'re| are)|it(?:'s| is)|the (?:build|firmware|product|device) is|product is|build is)\s+(compliant|certified|clear)\b/gi,
	},
	// A finding marked done: "gap fixed", "vulnerability resolved", "issue cleared"
	{ rule: "gap-verdict", re: /\b(?:gap|gaps|vuln(?:erability)?|vulns?|issue|finding|cve)\s+(fixed|resolved|done|cleared)\b/gi },
	// The documented closing-summary leak.
	{ rule: "summary-leak", re: /\btop gap\s+(fixed|resolved|done|cleared)\b/gi },
	// A status cell asserting a verdict. (Note: `\b` only on the word alternatives — a trailing `\b` after
	// the ✅ emoji never matches, since ✅ is not a word char.)
	{ rule: "status-verdict", re: /\bstatus:?\s*(?:[✅✔]|(?:fixed|resolved|done|compliant|pass(?:es|ed)?)\b)/gi },
	// "affected" as a verdict about the user's build (incl. "not affected") — NOT advisory "affected versions".
	{
		rule: "affected-verdict",
		re: /\b(?:you(?:'re| are)|build is|product is|is|are)\s+(?:not\s+)?affected\b(?!\s+versions?)/gi,
	},
	// An all-clear verdict: "you're (in the) clear".
	{ rule: "all-clear", re: /\b(?:you(?:'re| are)|build is|product is)\s+(?:in the\s+)?clear\b/gi },
]

/**
 * Scan generated CRA text for assertive verdict-word leaks. Returns one entry per match (line + snippet +
 * rule). Empty array = no documented leak shapes found (NOT proof the text is honest — see file header).
 */
export function scanForVerdictLeaks(content: string): VerdictLeak[] {
	const leaks: VerdictLeak[] = []
	const lines = content.split(/\r?\n/)
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (LIMIT_STATEMENT.test(line)) {
			continue // a "never say / won't claim …" meta-statement — not a verdict
		}
		for (const { rule, re } of LEAK_PATTERNS) {
			re.lastIndex = 0
			let m: RegExpExecArray | null
			// biome-ignore lint/suspicious/noAssignInExpressions: standard global-regex exec loop
			while ((m = re.exec(line)) !== null) {
				leaks.push({ line: i + 1, match: m[0].trim(), rule })
			}
		}
	}
	return leaks
}

/** Convenience: true if the text contains no documented verdict-leak shapes. */
export function isVerdictClean(content: string): boolean {
	return scanForVerdictLeaks(content).length === 0
}
