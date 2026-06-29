/**
 * CRA honesty STRUCTURE scan — the positive-presence complement to `verdictScan` (which only detects banned
 * verdicts that ARE present). This asserts the honest scaffolding that MUST be present in a generated CRA report
 * is actually there. It catches the failure a leak-detector structurally cannot: an **omission** — the fix-D
 * failure mode where the model dropped the disclaimer entirely before emitting a verdict (status 2026-06-24).
 *
 * Together: a generated report is honest iff `isVerdictClean(c)` (no bad verdict present) AND
 * `hasHonestStructure(c, profile)` (the required honest primitives present).
 *
 * Scope + limits (same as verdictScan): **CI / the eval harness only — NEVER a runtime content-shaper** (a
 * runtime presence-check that rewrites output is the architecture violation fix-D reverted). Run it over
 * GENERATED reports, not bit sources. It is high-recall on the documented primitives, not a proof of honesty.
 */

export type StructureProfile = "cve-scan" | "cra-readiness"

export interface MissingPrimitive {
	/** Stable id of the honest primitive that is absent. */
	id: string
	/** Why it must be present (for triage). */
	why: string
}

interface RequiredPrimitive extends MissingPrimitive {
	/** True iff the primitive is present in the content. */
	present: (content: string) => boolean
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/

/** The honest primitives required per report kind. Each maps to a real honesty rule the bits/formatters emit. */
const PROFILES: Record<StructureProfile, RequiredPrimitive[]> = {
	// The host-produced CVE evidence report (evidenceReport.ts) — and any model presentation of it.
	"cve-scan": [
		{
			id: "attribution-and-date",
			why: "every finding/no-match line must be attributed + dated ('… as of <YYYY-MM-DD>')",
			present: (c) => /as of\s+\d{4}-\d{2}-\d{2}/i.test(c),
		},
		{
			id: "coverage-stated",
			why: "coverage must be stated, never omitted (a bare result reads as complete when it isn't)",
			present: (c) => /^coverage:/im.test(c) || /\bqueryable\b/i.test(c),
		},
		{
			id: "partial-coverage-disclosed",
			why: "must disclose partial coverage — absence of a match is NEVER a clean bill of health",
			present: (c) => /partial coverage/i.test(c) || /not a complete check/i.test(c),
		},
		{
			id: "hedged",
			why: "findings/no-match text must be hedged toward verification ('verify'/'confirm')",
			present: (c) => /\b(?:verify|confirm)\b/i.test(c),
		},
	],
	// The model-produced CRA readiness report (cra/workflows/cra-readiness.md).
	"cra-readiness": [
		{
			// Parity (2906i): the ESP run retitled the H1 to "Bluedroid_Beacon — CRA Secure-by-Design Preview". The
			// disclaimer phrase was still present (so the old checks passed), but the report shipped a different shape
			// than every nRF report. The title is a fixed honesty-surface guarantee — enforce the canonical H1 on BOTH
			// platforms so the report can never be silently rebranded. Matches the H1 only (line-start '#'), not the
			// blockquoted '> #' inside the disclaimer, so a retitle with a verbatim disclaimer is still caught.
			id: "canonical-title",
			why: "the report's H1 must be the exact '# CRA SBOM & Fix — <project>' — NEVER retitled (a real ESP run renamed it, dodging parity with nRF). Restore the canonical title + the verbatim disclaimer block.",
			present: (c) => /^#\s+CRA SBOM & Fix\b/m.test(c),
		},
		{
			id: "at-a-glance",
			why: "the mandatory 'At a glance' counts line (N components · M CVEs · K not reachable · G gaps) must be in the header — a real ESP run shipped without it. Take the numbers VERBATIM from the host figures.",
			present: (c) => /at[\s-]a[\s-]glance/i.test(c),
		},
		{
			id: "attribution",
			why: "the report must carry the 'Generated: <date> by Adsum IoT Coder (CRA SBOM & Fix)' attribution line — a real ESP run dropped it. Add it to the header method line.",
			present: (c) => /by Adsum IoT Coder/i.test(c),
		},
		{
			id: "readiness-disclaimer",
			why: "the mandatory readiness disclaimer must be present + verbatim — fix-D: the model dropped it before a verdict",
			present: (c) => /not a conformity assessment/i.test(c),
		},
		{
			id: "hedged",
			why: "evidence-mode requires verification hedging ('verify'/'confirm')",
			present: (c) => /\b(?:verify|confirm)\b/i.test(c),
		},
		{
			id: "dated-evidence",
			why: "advisories / evidence must be dated ('as of <date>') so a snapshot isn't read as current truth",
			present: (c) => /as of\b/i.test(c) || ISO_DATE.test(c),
		},
	],
}

/** Return the honest primitives MISSING from the content for the given report kind (empty = structurally honest). */
export function scanForMissingStructure(content: string, profile: StructureProfile): MissingPrimitive[] {
	return PROFILES[profile].filter((p) => !p.present(content)).map(({ id, why }) => ({ id, why }))
}

/** True iff every required honest primitive for the report kind is present. */
export function hasHonestStructure(content: string, profile: StructureProfile): boolean {
	return scanForMissingStructure(content, profile).length === 0
}
