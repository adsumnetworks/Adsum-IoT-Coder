/**
 * Evidence-mode CVE artifact formatters (CVE scan loop — design/15 §7/§8). Assemble matches + applicability +
 * coverage into the §3 markdown the model presents verbatim (`formatCveScanReport`) AND the structured
 * `cve-scan-<date>.json` evidence artifact (`formatCveScanJson`) — the two §7 deliverables, built from the SAME
 * input so they can never disagree. Strictly evidence-mode: every claim is **attributed** (OSV) + **dated**
 * (as-of) + **hedged** (verify); coverage is reported honestly and the no-match case is NEVER framed as "clean".
 * Both outputs are self-checked by `verdictScan` in the tests. Pure; `asOf` is injected (no Date.now here).
 */
import type { ApplicabilityVerdict } from "./applicability"
import type { OsvMatch, SkippedComponent } from "./osvMatch"
import type { DropReason } from "./sbomNormalize"

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

/** Reason breakdown of the skipped set — the single derivation md + json both render (they can't disagree). */
function dropReasonCounts(skipped: SkippedComponent[]): Partial<Record<DropReason, number>> {
	const counts: Partial<Record<DropReason, number>> = {}
	for (const s of skipped) {
		counts[s.reason] = (counts[s.reason] ?? 0) + 1
	}
	return counts
}

/** The shared data-provenance caption (NOT a legal disclaimer — reuses the advisories "as of" shape, §8.1). */
const provenanceCaption = (source: string, asOf: string): string =>
	`${source} matches for your SBOM's component versions, as of ${asOf}. Partial coverage; ` +
	"version-matching can over- or under-report — open each linked advisory to confirm it applies to your build."

export function formatCveScanReport(input: EvidenceReportInput): string {
	const source = input.source ?? "OSV"
	const counts = dropReasonCounts(input.skipped)
	const cpeOnly = counts["cpe-only"] ?? 0
	const noId = counts["no-id"] ?? 0
	const noVersion = counts["no-version"] ?? 0

	const lines: string[] = [`## CVE scan — ${source}, as of ${input.asOf}`, "", `> ${provenanceCaption(source, input.asOf)}`, ""]

	// Parity rule (§8.4): when there are gaps we ALWAYS render the reason breakdown — never a bare count — so
	// nRF and ESP are described with equal honesty even though ESP's queryable ratio is structurally lower.
	const coverage = [`${input.queriedCount} queryable`]
	if (cpeOnly > 0) {
		coverage.push(`${cpeOnly} cpe-only (not OSV-queryable)`)
	}
	if (noId > 0) {
		coverage.push(`${noId} with no identifier`)
	}
	if (noVersion > 0) {
		coverage.push(`${noVersion} with no version`)
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

/** The structured `compliance/cve-scan-<date>.json` artifact (§7) — mirrors the markdown, same input, same data. */
export interface CveScanJson {
	schema: "adsum.cve-scan/1"
	source: string
	asOf: string
	/** The same provenance caption the markdown renders (verbatim) — honest about partial coverage. */
	provenance: string
	/** Coverage mirror: queryable count + the honest drop-reason breakdown (never a bare number when gaps exist). */
	coverage: { queryable: number; byDropReason: Partial<Record<DropReason, number>> }
	findings: Array<{
		component: string
		version: string
		advisories: Array<{ id: string; url: string }>
		/** Applicability is an EXCLUSION signal + a hedged note ending in "verify" — never a conformity verdict. */
		applicability: { signal: ApplicabilityVerdict["signal"]; note: string }
	}>
	skipped: Array<{ component: string; version: string; reason: DropReason }>
}

export function formatCveScanJson(input: EvidenceReportInput): string {
	const source = input.source ?? "OSV"
	const doc: CveScanJson = {
		schema: "adsum.cve-scan/1",
		source,
		asOf: input.asOf,
		provenance: provenanceCaption(source, input.asOf),
		coverage: { queryable: input.queriedCount, byDropReason: dropReasonCounts(input.skipped) },
		findings: input.findings.map((f) => ({
			component: f.match.component.name,
			version: f.match.component.version,
			advisories: f.match.vulnIds.map((id) => ({ id, url: advisoryUrl(id) })),
			applicability: { signal: f.applicability.signal, note: f.applicability.note },
		})),
		skipped: input.skipped.map((s) => ({ component: s.component.name, version: s.component.version, reason: s.reason })),
	}
	return JSON.stringify(doc, null, 2)
}
