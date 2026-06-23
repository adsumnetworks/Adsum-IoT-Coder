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

/** Leak patterns — each targets an *assertive* verdict shape, not a bare word. High-precision, not exhaustive. */
const LEAK_PATTERNS: LeakPattern[] = [
	// A ✅/✔/❌/✗ glued to a verdict — the canonical "✅ FIXED" leak.
	{
		rule: "glyph-verdict",
		re: /[✅✔❌✗]\s*(fixed|done|resolved|remediated|mitigated|pass(?:es|ed)?|fail(?:s|ed)?|compliant|certified|clear)\b/gi,
	},
	// A verdict glyph used as a TABLE CELL value — evidence-mode tables have no status-glyph column.
	{ rule: "glyph-cell", re: /\|\s*[✅✔❌✗]/g },
	// A PASS/FAIL grade — standalone UPPERCASE token (case-sensitive): "Secure boot: PASS", "| FAIL |".
	// Uppercase-only avoids prose "pass"/"fail" and substrings (BYPASS, FAILURE, PASSED).
	{ rule: "passfail", re: /(?<![A-Za-z])(?:PASS|FAIL)(?![A-Za-z])/g },
	// "now/fully compliant|certified|resolved|fixed|…"
	{
		rule: "now-verdict",
		re: /\b(?:now|fully|now fully)\s+(compliant|certified|resolved|fixed|done|cleared|clear|remediated|mitigated)\b/gi,
	},
	// Assertive subject + verdict: "you're compliant", "the build is certified".
	{
		rule: "assertive-verdict",
		re: /\b(?:you(?:'re| are)|it(?:'s| is)|the (?:build|firmware|product|device) is|product is|build is)\s+(compliant|certified|clear)\b/gi,
	},
	// A finding marked done: "gap fixed/resolved/remediated/mitigated/addressed/closed".
	{
		rule: "gap-verdict",
		re: /\b(?:gap|gaps|vuln(?:erability)?|vulns?|issue|finding|cve)\s+(fixed|resolved|done|cleared|remediated|mitigated|addressed|closed)\b/gi,
	},
	// Passive done-claim: "has been fixed/resolved/remediated/mitigated" (e.g. "the CVE has been mitigated").
	{ rule: "passive-done", re: /\b(?:has|have|had)\s+been\s+(fixed|resolved|remediated|mitigated|addressed|cleared)\b/gi },
	// Clearance claims: "all gaps closed", "no gaps remain", "ready to ship".
	{
		rule: "clearance",
		re: /\b(?:all gaps|all findings)\s+(?:closed|addressed|resolved|cleared)\b|\bno gaps?\s+(?:remain|left)\b|\bready to ship\b/gi,
	},
	// Paraphrased conformity verdicts (named in the threat list — high-value, still not exhaustive).
	{
		rule: "paraphrase-verdict",
		re: /\b(?:satisfies|satisfy|meets|meet|fulfils?|fulfills?|complies with|conforms to)\s+(?:the\s+|all\s+)?(?:requirement|requirements|annex|cra|essential|conformity)/gi,
	},
	{ rule: "fully-addressed", re: /\bfully addressed\b/gi },
	// The documented closing-summary leak.
	{ rule: "summary-leak", re: /\btop gap\s+(fixed|resolved|done|cleared|remediated)\b/gi },
	// A status cell asserting a verdict. (`\b` only on the word alternatives — a trailing `\b` after the ✅
	// emoji never matches, since ✅ is not a word char.)
	{
		rule: "status-verdict",
		re: /\bstatus:?\s*(?:[✅✔]|(?:fixed|resolved|done|compliant|certified|clear(?:ed)?|pass(?:es|ed)?)\b)/gi,
	},
	// "affected" as a verdict about the USER's build — NOT advisory metadata ("builds…are affected",
	// "versions are affected", "affected versions"). Requires a 2nd-person / "your build" subject.
	{ rule: "affected-verdict", re: /\b(?:you(?:'re| are)|your (?:build|product|firmware|device) is)\s+(?:not\s+)?affected\b/gi },
	// An all-clear verdict: "you're (in the) clear".
	{ rule: "all-clear", re: /\b(?:you(?:'re| are)|your (?:build|product) is)\s+(?:in the\s+)?clear\b/gi },
]

/**
 * Scan generated CRA text for assertive verdict-word leaks. Returns one entry per match (line + snippet +
 * rule). Empty array = no documented leak shapes found (NOT proof the text is honest — see file header).
 */
export function scanForVerdictLeaks(content: string): VerdictLeak[] {
	const leaks: VerdictLeak[] = []
	const lines = content.split(/\r?\n/)
	for (let i = 0; i < lines.length; i++) {
		// Split into clauses so a meta-clause ("I won't claim…") only shields ITS clause, not a verdict in a
		// sibling clause on the same line ("…, but your build is now compliant").
		const clauses = lines[i].split(/(?:;|\.\s+|\s[—–]\s|,?\s+(?:but|and)\s+)/i)
		for (const clause of clauses) {
			if (LIMIT_STATEMENT.test(clause)) {
				continue // a "never say / won't claim …" meta-clause — not a verdict
			}
			for (const { rule, re } of LEAK_PATTERNS) {
				re.lastIndex = 0
				let m: RegExpExecArray | null
				// biome-ignore lint/suspicious/noAssignInExpressions: standard global-regex exec loop
				while ((m = re.exec(clause)) !== null) {
					leaks.push({ line: i + 1, match: m[0].trim(), rule })
				}
			}
		}
	}
	return leaks
}

/** Convenience: true if the text contains no documented verdict-leak shapes. */
export function isVerdictClean(content: string): boolean {
	return scanForVerdictLeaks(content).length === 0
}
