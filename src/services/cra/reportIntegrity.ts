/**
 * CRA readiness-report integrity guard (F1).
 *
 * The CRA readiness report (`compliance/CRA_READINESS.md`) is composed entirely by the model — the host
 * otherwise saves it unread. A real run once saved fabricated claims ("Total packages: 91 / generated via
 * west spdx / no CVEs detected") when the SBOM on disk actually had 1 package, was made by west ncs-sbom, and
 * the CVE scan found 0 queryable components. For a compliance artifact that is the worst failure mode.
 *
 * This module re-derives the ground truth from the artifacts the run actually produced (the SPDX via the same
 * `normalizeSbom` the CVE scanner uses, and the `cve-scan-*.json` coverage) and flags **provable
 * contradictions** between the report's claims and those artifacts, plus missing honest-framing primitives
 * (via the existing `structureScan`). The write handler turns any issue into a tool error so the model rewrites
 * with the real figures — it never rewrites the model's text itself.
 *
 * Design choices that keep false-positives low:
 *  - Only blocks on a CONTRADICTION (an explicit claim that differs from the artifact), never on absence of a
 *    claim. No SBOM on disk → no count/tool check.
 *  - Compares like-for-like deterministic facts (package count, generator tool, 0-queryable framing).
 *  - The host wrapper fails OPEN: any internal error → no issues → the write proceeds (a guard bug must never
 *    block a legitimate compliance report).
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { scanForMissingStructure } from "../knowledge/honesty/structureScan"
import { scanForVerdictLeaks } from "../knowledge/honesty/verdictScan"
import { type NormalizedSbom, normalizeSbom } from "./sbomNormalize"

/** CVE id, e.g. CVE-2024-49010. */
const CVE_ID_RE = /\bCVE-\d{4}-\d{4,7}\b/gi

export interface IntegrityIssue {
	kind: string
	detail: string
}

// Generator tools we can name on both sides (the SPDX's own creator string AND the report's prose).
const SBOM_TOOLS: Array<{ id: string; re: RegExp }> = [
	{ id: "west ncs-sbom", re: /\b(?:west[-\s]+)?ncs-sbom\b/i },
	{ id: "esp-idf-sbom", re: /\besp-idf-sbom\b/i },
	{ id: "west spdx", re: /\bwest\s+spdx\b/i },
]

/** First SBOM generator named in free text (a report's prose or an SPDX creator field), else null. */
export function detectSbomTool(text: string): string | null {
	for (const t of SBOM_TOOLS) {
		if (t.re.test(text)) {
			return t.id
		}
	}
	return null
}

/** A package count explicitly claimed in the report's SBOM summary ("Total packages: 91" / "| Total packages | 91 |"). */
export function extractClaimedPackageCount(text: string): number | null {
	const m = text.match(/total\s+packages\b[^\d]{0,16}(\d{1,6})/i)
	return m ? Number(m[1]) : null
}

function assertsCleanCve(text: string): boolean {
	return /\bno\s+(?:known\s+|applicable\s+)?(?:cves?|vulnerabilit\w+)\b/i.test(text)
}

function hasCveCoverageCaveat(text: string): boolean {
	return /\bqueryable\b|not a complete check|coverage gap|\bunidentified\b/i.test(text)
}

/**
 * A markdown file that carries the CRA readiness disclaimer + an SBOM section is the readiness report — detect
 * by content so it works regardless of the (run-varied) filename. Anything we classify here already contains
 * the disclaimer, so structureScan's disclaimer primitive is implicitly satisfied.
 */
export function looksLikeReadinessReport(absolutePath: string, content: string): boolean {
	if (!/\.md$/i.test(absolutePath)) {
		return false
	}
	// (1) Canonical signal: the disclaimer phrase + an SBOM mention.
	if (/not a conformity assessment/i.test(content) && /\bSBOM\b/i.test(content)) {
		return true
	}
	// (2) Drift-proofing (2806c): a RETITLED report that DROPPED the disclaimer phrase ("CRA Readiness Assessment",
	// no "not a conformity assessment") otherwise slipped past (1) → the guard never ran and glyphs + fabricated
	// clauses shipped. Re-detect by location + the consolidated report's own shape (SBOM section + a posture/Annex
	// signal), so a renamed or disclaimer-stripped report still classifies — then structureScan rejects it for the
	// missing disclaimer. Filename markers catch the date-stamped `cra-readiness-<date>.md`; the `compliance/` path
	// catches arbitrary renames. The consolidated shape (SBOM + posture/Kconfig/Annex) excludes the CVE-scan-only
	// `cve-scan-*.md` and the `.spdx` inventories, which carry neither a posture section nor Annex citations.
	const filenameMarks = /(?:^|[\\/])(?:cra[_-]?readiness|cra[_-]?sbom|CRA_READINESS)[^\\/]*\.md$/i.test(absolutePath)
	const inCompliance = /[\\/]compliance[\\/]/i.test(absolutePath)
	const consolidated = /\bSBOM\b/i.test(content) && /\b(?:posture|Kconfig|CONFIG_[A-Z]|Annex\s+[IVX])/i.test(content)
	if ((filenameMarks || inCompliance) && consolidated) {
		return true
	}
	return false
}

/** Pure cross-check: the report's claims vs the real artifacts. Returns only provable contradictions + missing primitives. */
export function checkReadinessReportIntegrity(input: {
	reportText: string
	sbom?: NormalizedSbom | null
	/** Raw SPDX text — used only to read the generator tool out of the SPDX's own creator fields. */
	sbomText?: string | null
	/** `coverage.queryable` from the run's cve-scan json, if a CVE scan was run. */
	cveQueryable?: number | null
	/** Every CVE id present in the run's cve-scan json. If provided, any CVE the report cites that is NOT in
	 *  this set is flagged as fabricated (F12 — a real run claimed "scan found CVE-2024-49010" that the host
	 *  scan never produced). Undefined = no scan ran → don't validate cited ids. */
	scannedCveIds?: string[] | null
}): IntegrityIssue[] {
	const issues: IntegrityIssue[] = []
	const text = input.reportText

	if (input.sbomText) {
		const real = detectSbomTool(input.sbomText)
		const claimed = detectSbomTool(text)
		if (real && claimed && claimed !== real) {
			issues.push({
				kind: "sbom-tool",
				detail: `Report names "${claimed}" as the SBOM tool, but the SBOM on disk was generated by "${real}". State the tool that actually ran.`,
			})
		}
	}

	if (input.sbom) {
		const claimed = extractClaimedPackageCount(text)
		if (claimed != null && claimed !== input.sbom.coverage.total) {
			issues.push({
				kind: "package-count",
				detail: `Report states "Total packages: ${claimed}", but the SBOM on disk has ${input.sbom.coverage.total}. Use the real package count from the SPDX.`,
			})
		}
	}

	if (input.cveQueryable === 0 && assertsCleanCve(text) && !hasCveCoverageCaveat(text)) {
		issues.push({
			kind: "cve-framing",
			detail: `The CVE scan had 0 queryable components, but the report frames it as "no CVEs found" without noting that nothing was scanned. Report it as a coverage gap (e.g. "0 queryable — not a complete check"), not a clean result.`,
		})
	}

	// F12: verdict-mode leaks — ✅/⚠️/❌, ENABLED/MET/READY/COMPLIANT, numeric scores. A CRA report is
	// evidence-mode; a real run wrote a "✅ Enabled" posture table at the wrap-up (default "prose" mode).
	const verdictLeaks = scanForVerdictLeaks(text)
	if (verdictLeaks.length > 0) {
		const samples = [...new Set(verdictLeaks.map((l) => l.match))].slice(0, 5).join(", ")
		issues.push({
			kind: "verdict-leak",
			detail: `Report uses verdict-style status (${samples}${verdictLeaks.length > 5 ? ", …" : ""}). CRA reports are evidence-mode: no ✅/⚠️/❌, no ENABLED/MET/READY/COMPLIANT, no scores — state the literal evidence + what to verify.`,
		})
	}

	// F12: any CVE the report attributes must come from the scan. A real run fabricated "scan found CVE-2024-49010".
	if (input.scannedCveIds) {
		const known = new Set(input.scannedCveIds.map((s) => s.toUpperCase()))
		const fabricated = [...new Set((text.match(CVE_ID_RE) ?? []).map((s) => s.toUpperCase()))].filter((id) => !known.has(id))
		if (fabricated.length > 0) {
			issues.push({
				kind: "cve-fabricated",
				detail: `Report cites CVE id(s) the scan did not produce: ${fabricated.join(", ")}. Cite only CVEs from compliance/cve-scan-*.json — remove these or re-run the scan.`,
			})
		}
	}

	for (const m of scanForMissingStructure(text, "cra-readiness")) {
		issues.push({ kind: `missing-${m.id}`, detail: m.why })
	}

	return issues
}

/** First `.spdx`/`.spdx.json` found next to the report (typically `<dir>/sbom/` or `<dir>/`), as raw text. */
function findSiblingSpdx(reportDir: string): string | null {
	for (const d of [path.join(reportDir, "sbom"), reportDir]) {
		try {
			const f = fs.readdirSync(d).find((n) => /\.spdx(\.json)?$/i.test(n))
			if (f) {
				return fs.readFileSync(path.join(d, f), "utf8")
			}
		} catch {
			// dir absent / unreadable — try the next candidate
		}
	}
	return null
}

/** From a sibling `cve-scan-*.json`: the queryable count + every CVE id present. null if none/unreadable. */
function findSiblingCve(reportDir: string): { queryable: number | null; cveIds: string[] } | null {
	try {
		const f = fs.readdirSync(reportDir).find((n) => /^cve-scan.*\.json$/i.test(n))
		if (!f) {
			return null
		}
		const raw = fs.readFileSync(path.join(reportDir, f), "utf8")
		const j = JSON.parse(raw)
		const q = j?.coverage?.queryable
		const cveIds = [...new Set((raw.match(CVE_ID_RE) ?? []).map((s) => s.toUpperCase()))]
		return { queryable: typeof q === "number" ? q : null, cveIds }
	} catch {
		return null
	}
}

/**
 * Host entry point: if `content` is a readiness report, read its sibling artifacts off disk and run the pure
 * check. Fails OPEN (returns []) on any error so a guard fault can never block a legitimate write.
 */
export function gatherAndCheckReadinessIntegrity(absolutePath: string, content: string): IntegrityIssue[] {
	try {
		if (!looksLikeReadinessReport(absolutePath, content)) {
			return []
		}
		const dir = path.dirname(absolutePath)
		const sbomText = findSiblingSpdx(dir)
		const cve = findSiblingCve(dir)
		return checkReadinessReportIntegrity({
			reportText: content,
			sbom: sbomText ? normalizeSbom(sbomText) : null,
			sbomText,
			cveQueryable: cve?.queryable ?? null,
			scannedCveIds: cve?.cveIds ?? null,
		})
	} catch {
		return []
	}
}

/** Render the issues into a tool-error the model can act on (rewrite with real figures). */
export function formatIntegrityError(issues: IntegrityIssue[]): string {
	return [
		"CRA readiness report rejected: its claims don't match the real artifacts this run produced (Adsum integrity guard).",
		"Do NOT restate from memory. Re-read the generated SBOM / CVE-scan output and rewrite the report using only those figures:",
		...issues.map((i) => `  • ${i.detail}`),
	].join("\n")
}
