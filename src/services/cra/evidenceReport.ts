/**
 * Evidence-mode CVE report formatter (CVE scan loop — design/15 §7/§8). Assembles matches + applicability +
 * coverage into the §3 markdown the model presents verbatim. Strictly evidence-mode: every claim is
 * **attributed** (OSV) + **dated** (as-of) + **hedged** (verify); coverage is reported honestly and the
 * no-match case is NEVER framed as "clean". The output is self-checked by `verdictScan` in the test, so the
 * formatter can't drift into a banned verdict. Pure; the `asOf` date is injected (no Date.now in pure code).
 */
import type { ApplicabilityVerdict } from "./applicability"
import type { OsvMatch, SkippedComponent } from "./osvMatch"

export interface ScanFinding {
	match: OsvMatch
	applicability: ApplicabilityVerdict
}

export interface EvidenceReportInput {
	findings: ScanFinding[]
	skipped: SkippedComponent[]
	queriedCount: number
	/** ISO date (e.g. "2026-06-24"), injected by the caller. */
	asOf: string
	source?: string
}

const advisoryUrl = (id: string) => `https://osv.dev/vulnerability/${id}`

export function formatCveScanReport(input: EvidenceReportInput): string {
	const source = input.source ?? "OSV"
	const cpeOnly = input.skipped.filter((s) => s.reason === "cpe-only").length
	const noId = input.skipped.filter((s) => s.reason === "no-identifier").length

	const lines: string[] = [
		`## CVE scan — ${source}, as of ${input.asOf}`,
		"",
		// Data-provenance caption (NOT a legal disclaimer — reuses the advisories "as of" caption shape, §8.1).
		`> ${source} matches for your SBOM's component versions, as of ${input.asOf}. Partial coverage; ` +
			"version-matching can over- or under-report — open each linked advisory to confirm it applies to your build.",
		"",
	]

	const coverage = [`${input.queriedCount} queryable`]
	if (cpeOnly > 0) {
		coverage.push(`${cpeOnly} cpe-only (not OSV-queryable)`)
	}
	if (noId > 0) {
		coverage.push(`${noId} with no identifier`)
	}
	lines.push(`Coverage: ${coverage.join(" · ")}.`, "")

	if (input.findings.length === 0) {
		lines.push(
			`No ${source} matches as of ${input.asOf} for the ${input.queriedCount} queryable components. ` +
				"This is not a complete check — components without an identifier were not scanned; open the live advisories to confirm.",
		)
		return lines.join("\n")
	}

	for (const f of input.findings) {
		const c = f.match.component
		const idLinks = f.match.vulnIds.map((id) => `[${id}](${advisoryUrl(id)})`).join(", ")
		lines.push(`- **${c.name}@${c.version}** — ${source} reports ${idLinks} (as of ${input.asOf}). ${f.applicability.note}`)
	}
	return lines.join("\n")
}
