/**
 * CRA honesty scan (readiness-not-compliance) — a HIGH-PRECISION static guard against verdict-word leaks
 * in **generated** CRA output (a written `compliance/*.md` report, or an offer / closing-summary string).
 *
 * Scope + honest limits (read before trusting this):
 * - It targets the **documented leak shapes** (the failures the project actually hit): a ✅ glued to a
 *   verdict, "now compliant", "gap/vuln fixed/resolved", "you're affected/clear", "Top gap fixed",
 *   "status: ✅/fixed", "✅ Built & verified" (build ≠ verification), a status glyph as a bullet/cell marker ("- ✅ … built"). It is a **safety net, not a guarantee** — it will NOT catch a paraphrased verdict
 *   ("your firmware satisfies the requirement"). The load-bearing honesty guards remain the bit rules
 *   (evidence-mode, verify-the-positive-AND-negative) — this only catches the literal leaks.
 * - It is **high-precision by design**: it skips negated / meta uses so it does not fire on the CRA
 *   disclaimer itself ("NOT a conformity assessment", "✅ means configured, never compliant/correct/done",
 *   "I will never tell you you're clear", "not affected"). Run it over GENERATED reports + offer/summary
 *   strings — not over the bit SOURCES (which legitimately quote the banned words in their rules).
 *
 * Intended use: CI / the eval harness (scan generated fixtures). NOT a runtime write blocker (that would
 * false-positive on disclaimers and is too heavy) — runtime honesty is the bits' job, not the host's. See
 * design/06 + design/07 + the red-team MF4.
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

/**
 * ATTRIBUTION+DATE cue — the design's evidence-mode contract (§8.1): a CVE statement is honest ONLY when it
 * is sourced AND dated ("OSV reports CVE-X fixed in 1.2.4, as of 2026-06-23"). This is the discriminator the
 * red-team said had "no design": an *unattributed, undated* CVE state-claim ("CVE-X is fixed") is a verdict;
 * the *same verb* inside an attributed-dated quote of a public database is evidence. We require BOTH cues on
 * the clause: ATTRIBUTION (a named source) AND a DATE ("as of <date>" / ISO-date). Either alone is insufficient
 * (a bare "as of today" names no source; "OSV" with no date is a stale quote). This gates ONLY the CVE-state
 * rules (cve-state-verdict / gap-verdict / passive-done / vex-token-in-prose) — bare conformity verdicts
 * ("you're compliant", scores, glyphs) carry no source noun and stay banned regardless.
 *
 * Attribution = a SOURCE NOUN on the clause (the discriminator is "we name whose claim this is"). We do NOT
 * additionally require a reporting verb: the canonical shape pairs noun+verb ("OSV reports …") but a copula
 * quote is equally attributed ("per the GHSA advisory, CVE-X is fixed in 1.2.4, as of D") — and the §11
 * red-team's whole point is the loop must be able to phrase the quote naturally. The DATE cue is what blocks a
 * bare stale claim; the SOURCE NOUN is what separates a quote from a self-authored verdict.
 */
const CVE_SOURCE_NOUN =
	/\b(?:osv(?:\.dev)?|euvd|enisa|nvd|ghsa|cisa[- ]?kev|kev|epss|the\s+advisory|advisory|psirt|nordic|espressif)\b/i
const HAS_DATE =
	/\bas of\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i

/** A clause is an attributed-dated EVIDENCE quote (honest) iff it NAMES A SOURCE and carries a date. */
function isAttributedDatedEvidence(clause: string): boolean {
	return CVE_SOURCE_NOUN.test(clause) && HAS_DATE.test(clause)
}

/**
 * The VERBATIM anti-clean allowance from the §8.1a coverage caption ("…that is a limit of our matching, **not
 * evidence your build is clean**…"). This is the single honest phrasing that legitimately pairs a "clean" claim
 * with the dev's build — it says the OPPOSITE of a verdict (it tells the dev a low match count is NOT a clean
 * bill of health). The `clean-verdict` rule below would otherwise false-positive on it (the caption literally
 * contains the substring "your build is clean"), so any clause carrying this exact allowance shape suppresses
 * that rule. Same allowance the §8.2 design pins for the coverage-clean-implication rule — kept as ONE shared
 * discriminator so the honest caption and the dishonest verdict can never be confused and the two rules never
 * drift apart.
 */
const ANTI_CLEAN_ALLOWANCE = /\bnot\s+evidence\b[^.]*\bclean\b/i

/**
 * The enumerated VEX status tokens (CycloneDX/OpenVEX §7). In the **machine VEX artifact** (`compliance/vex.json`)
 * these are LEGITIMATE field values the dev asserts and enterprise scanners ingest — banning them there would
 * forbid producing the deliverable at all. In **dev-facing prose / readiness tables** the very same token is a
 * verdict about the dev's build. Same vocabulary, opposite verdict → the cut is CONTEXT (the file), not the word.
 * `scanForVerdictLeaks(content, { mode: "vex" })` allows these as field values; the default `"prose"` bans them.
 */
export const VEX_STATUS_TOKENS = ["affected", "not_affected", "fixed", "under_investigation"] as const

/** The enumerated VEX status tokens as a regex alternation (`not_affected` ⇒ `not[_\s]affected`) — single
 * source of truth shared by the prose-leak rules so the ban-list and the allow-list (mode "vex") never drift. */
const VEX_TOKEN_ALT = VEX_STATUS_TOKENS.map((t) => t.replace(/_/g, "[_\\s]")).join("|")

/** Scan modes. `"prose"` (default) = dev-facing report/offer/summary. `"vex"` = the machine VEX artifact. */
export type ScanMode = "prose" | "vex"

interface LeakPattern {
	rule: string
	re: RegExp
	/** If set, this rule fires only in these modes. Default = all modes. */
	modes?: ScanMode[]
	/** If true, the rule is suppressed when the clause is an attributed-dated evidence quote (§8.1). */
	allowIfAttributedDated?: boolean
	/**
	 * If true, the rule is suppressed when the clause carries the verbatim §8.1a anti-clean allowance
	 * ("not evidence … clean"). Lets the honest coverage caption keep the word "clean" while the bare
	 * "your build is clean" verdict is still caught. Used by `clean-verdict`.
	 */
	allowIfAntiCleanClause?: boolean
}

/** Leak patterns — each targets an *assertive* verdict shape, not a bare word. High-precision, not exhaustive. */
const LEAK_PATTERNS: LeakPattern[] = [
	// A ✅/✔/❌/✗ glued to a verdict — the canonical "✅ FIXED" leak.
	{
		rule: "glyph-verdict",
		re: /[✅✔❌✗]\s*\*{0,2}\s*(fixed|done|resolved|remediated|mitigated|pass(?:es|ed)?|fail(?:s|ed)?|compliant|certified|clear|verified|built|complete|met|ready|good|enabled)\b/gi,
	},
	// A verdict glyph used as a TABLE CELL value — evidence-mode tables have no status-glyph column.
	{ rule: "glyph-cell", re: /\|\s*[✅✔❌✗⚠]/g },
	// A status glyph used as a BULLET / list-item / line-start marker ("- ✅ MCUboot built", "✅ done",
	// "⚠️ debug key") — evidence-mode output carries NO status glyphs. Anchored to clause/bullet start, so the
	// disclaimer's mid-sentence "A ✅ means …" (preceded by "A ") never trips. `g` flag → the exec-loop ends.
	{ rule: "glyph-bullet", re: /^\s*(?:[-*+]|\d+[.)])?\s*\*{0,2}\s*[✅✔❌✗⚠]/g },
	// A PASS/FAIL grade — standalone UPPERCASE token (case-sensitive): "Secure boot: PASS", "| FAIL |".
	// Uppercase-only avoids prose "pass"/"fail" and substrings (BYPASS, FAILURE, PASSED).
	{ rule: "passfail", re: /(?<![A-Za-z])(?:PASS|FAIL)(?![A-Za-z])/g },
	// A verdict glyph opening a markdown HEADING ("### ⚠️ MCUMGR UART …") — evidence-mode headings carry no
	// status glyph (a real run put "### ⚠️" on its top-gap heading). Anchored to the `#`-run start.
	{ rule: "heading-glyph", re: /^#{1,6}\s+\*{0,2}\s*[✅✔❌✗⚠]/g },
	// A verdict word as a JSON value on a posture/readiness key — the machine-readable `cra-readiness.json`
	// carried `"cra_readiness": "READY …"`, `"secure_boot": "ENABLED"`, `"sbom_completeness": "GOOD"`. Only
	// fires when the value STARTS with a verdict word, so an evidence value ("CONFIG_…=y — verify") stays clean.
	{
		rule: "json-verdict",
		re: /"[a-z_]*(?:readiness|posture|status|completeness|secure_boot|update_path)"\s*:\s*"\s*(?:ready|met|good|enabled|pass(?:ed)?|compliant|certified|clear)\b/gi,
	},
	// run #8 — "the product is non-compliant" (the assertive-verdict rule below matches only "compliant", so the
	// "non-" prefix slips past it). Covers non-compliant / non compliant / noncompliant. LIMIT_STATEMENT still
	// skips a meta clause ("I will never call it non-compliant").
	{ rule: "non-compliant", re: /\bnon[-\s]?compliant\b/gi },
	// run #8 — a numeric READINESS GRADE ("Firmware Update 0/10", "Aggregate CRA Readiness 5.7/10", "7 out of 10").
	// Scoring readiness IS a verdict. Anchored to a /10 (or "out of 10") denominator so it never eats a version
	// ("SPDX 2.3", "NCS 3.2.1") or an evidence count ("3/3 images present").
	{ rule: "score-grade", re: /\b(?:10|\d(?:\.\d+)?)\s*\/\s*10\b|\b\d+(?:\.\d+)?\s+out of\s+10\b/gi },
	// run #8 — a FABRICATED CRA article SUB-CLAUSE ("Article 3(8)", "Art. 5(2)"). The bit cites only the curated
	// Annex Part I/II + the one curated "Article 14" reference (which has NO sub-clause), so matching the `(N)`
	// sub-clause shape catches the invention without touching the legitimate "Article 14 / Art. 14".
	{ rule: "fabricated-article", re: /\bart(?:icle|\.)\s*\d+\s*\(\d+\)/gi },
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
	// CVE STATE-CLAIM (red-team MF: the prose done-claims that slipped gap-verdict because a CVE *id* sits
	// between the subject and the verb — "CVE-2025-0001 fixed after the bump" — or because the verb is a copula
	// — "CVE-X is fixed", "the vulnerability is fixed"). Also catches the bare/enumerated VEX status tokens
	// leaking into PROSE ("not_affected", "fixed (in build 5340)"). PROSE-ONLY (the machine vex.json legitimately
	// carries these as field values — see VEX_STATUS_TOKENS + mode "vex"). SUPPRESSED on an attributed-dated
	// evidence clause ("OSV reports CVE-X fixed in 1.2.4, as of 2026-06-23") — the §8.1 attribution+date cut.
	{
		rule: "cve-state-verdict",
		modes: ["prose"],
		allowIfAttributedDated: true,
		re: /\b(?:cve[-\s]?\d{4}[-\s]?\d{3,7}|vuln(?:erability)?|vulns?|the\s+(?:cve|finding|issue))\b[^.|]*?\b(?:is|are|was|were|now|got|gets?)?\s*(fixed|resolved|remediated|mitigated|patched|not[_\s]affected|unaffected)\b/gi,
	},
	// The bare enumerated VEX status token used as a standalone PROSE marker / table cell — "| … | fixed |",
	// "not_affected", a line that is just a status word. PROSE-ONLY; allowed (as a field value) in mode "vex".
	// Attributed-dated evidence ("OSV reports … fixed … as of D") is suppressed via allowIfAttributedDated.
	{
		rule: "vex-token-in-prose",
		modes: ["prose"],
		allowIfAttributedDated: true,
		re: new RegExp(`(?:^|\\|)\\s*\\*{0,2}\\s*(?:${VEX_TOKEN_ALT})\\b\\s*\\*{0,2}\\s*(?:\\(|\\||$)`, "gi"),
	},
	// A VEX status token (or a done-verb) as a JSON FIELD VALUE on a status-family key smuggled into a PROSE
	// file — "status": "fixed", "vex_status":"not_affected", "determination": "remediated". The machine VEX
	// artifact (`compliance/vex.json`) legitimately carries these field values (mode "vex" + craScanModeForPath),
	// but the SAME `{"status":"fixed"}` pasted into a `*.md` report is a verdict about the dev's build. The
	// vex-token-in-prose rule above anchors the token to a clause start / `|` cell wall, so a token preceded by
	// `: "` (the JSON colon-quote) slips it; this rule closes that gap. Sibling of `json-verdict` (which guards
	// readiness/posture/secure_boot keys); this one guards the VEX status-family keys. PROSE-ONLY; the §8.1
	// attribution+date gate still allows a sourced-dated value ("status":"fixed in 1.2.4 per OSV, as of D").
	{
		rule: "json-vex-status",
		modes: ["prose"],
		allowIfAttributedDated: true,
		re: new RegExp(
			`"[a-z_]*(?:status|state|vex|determination)"\\s*:\\s*"\\s*(?:${VEX_TOKEN_ALT}|fixed|resolved|remediated|mitigated|patched)\\b`,
			"gi",
		),
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
		re: /\bstatus:?\s*\*{0,2}\s*(?:[✅✔]|(?:fixed|resolved|done|compliant|certified|clear(?:ed)?|pass(?:es|ed)?|verified|built|complete)\b)/gi,
	},
	// "affected" as a verdict about the USER's build — NOT advisory metadata ("builds…are affected",
	// "versions are affected", "affected versions"). Requires a 2nd-person / "your build" subject.
	{ rule: "affected-verdict", re: /\b(?:you(?:'re| are)|your (?:build|product|firmware|device) is)\s+(?:not\s+)?affected\b/gi },
	// An all-clear verdict: "you're (in the) clear".
	{ rule: "all-clear", re: /\b(?:you(?:'re| are)|your (?:build|product) is)\s+(?:in the\s+)?clear\b/gi },
	// "clean" as a VERDICT about the user's build — the natural laundering of a no-findings adjudication
	// ("your build is clean", "you're clean", "the firmware is now clean"). The exact shape that slipped the
	// attribution+date gate: a self-authored "clean" verdict borrows a source noun + date in a SIBLING clause,
	// but the verdict clause itself names no source — so the attribution cut never even applies; "clean" simply
	// was not in the subject-anchored verdict vocabulary. Subject-anchored (same shape as all-clear /
	// affected-verdict) so the attributive "a clean build" (a build artifact, not a verdict) never trips.
	// SUPPRESSED on the §8.1a anti-clean allowance ("not evidence … clean") so the honest coverage caption —
	// which legitimately says "not evidence your build is clean" — stays clean while the bare verdict is caught.
	{
		rule: "clean-verdict",
		allowIfAntiCleanClause: true,
		re: /\b(?:you(?:'re| are)|your (?:build|product|firmware|device) is|the (?:build|firmware|product|device) is|product is|build is)\s+(?:now\s+|fully\s+)?clean\b/gi,
	},
]

export interface ScanOptions {
	/**
	 * `"prose"` (default) — a dev-facing readiness report / offer / closing-summary. Bans the VEX status tokens
	 * as verdicts. `"vex"` — the machine VEX artifact (`compliance/vex.json`): the enumerated status field values
	 * (`affected`/`not_affected`/`fixed`/`under_investigation`) are LEGITIMATE there and allowed, but the prose
	 * conformity verdicts ("you're compliant", "✅ FIXED", scores) are STILL banned — the VEX file must not smuggle
	 * an adjudication. Use `craScanModeForPath()` to pick the mode from the output path.
	 */
	mode?: ScanMode
}

/**
 * Scan generated CRA text for assertive verdict-word leaks. Returns one entry per match (line + snippet +
 * rule). Empty array = no documented leak shapes found (NOT proof the text is honest — see file header).
 *
 * Mode (red-team MF — the VEX/scan asymmetry): the SAME token (`fixed`/`not_affected`) is a dishonest verdict
 * in a dev-facing report but a legitimate field value in `compliance/vex.json`. Pass `{ mode: "vex" }` for the
 * machine artifact (allows the enumerated status fields, keeps banning prose verdicts); default `"prose"` bans
 * the tokens as verdicts. Honest attributed-dated CVE quotes ("OSV reports CVE-X fixed in 1.2.4, as of D") are
 * allowed in BOTH modes via the §8.1 attribution+date gate.
 */
export function scanForVerdictLeaks(content: string, opts: ScanOptions = {}): VerdictLeak[] {
	const mode: ScanMode = opts.mode ?? "prose"
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
			// §8.1 evidence cut: an attributed-AND-dated quote of a public DB is honest evidence, not a verdict.
			// Computed once per clause; gates only the rules flagged allowIfAttributedDated (CVE state-claims).
			const attributedDated = isAttributedDatedEvidence(clause)
			// §8.1a: the honest coverage caption legitimately carries "not evidence … clean" — computed once
			// per clause, gates only the clean-verdict rule (allowIfAntiCleanClause).
			const antiCleanClause = ANTI_CLEAN_ALLOWANCE.test(clause)
			for (const { rule, re, modes, allowIfAttributedDated, allowIfAntiCleanClause } of LEAK_PATTERNS) {
				if (modes && !modes.includes(mode)) {
					continue // rule does not apply in this mode (e.g. VEX status tokens are legal in mode "vex")
				}
				if (allowIfAttributedDated && attributedDated) {
					continue // "OSV reports CVE-X fixed in 1.2.4, as of 2026-06-23" — sourced + dated = evidence
				}
				if (allowIfAntiCleanClause && antiCleanClause) {
					continue // "not evidence your build is clean" — the §8.1a caption, the opposite of a verdict
				}
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

/**
 * Pick the scan mode from a generated file's path: the machine VEX artifact (`compliance/vex.json`, or any
 * `*vex*.json`) is scanned in `"vex"` mode (status field values allowed); everything else (`*.md` reports,
 * offer/summary strings) in `"prose"` mode. Keeps the context-cut (file, not vocabulary) in one place so the
 * CI/eval harness routes each artifact correctly.
 */
export function craScanModeForPath(absolutePath: string): ScanMode {
	const norm = absolutePath.replace(/\\/g, "/").toLowerCase()
	return /(^|\/)[^/]*vex[^/]*\.json$/.test(norm) ? "vex" : "prose"
}

/** Convenience: true if the text contains no documented verdict-leak shapes. */
export function isVerdictClean(content: string, opts: ScanOptions = {}): boolean {
	return scanForVerdictLeaks(content, opts).length === 0
}
