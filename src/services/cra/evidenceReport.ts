/**
 * Evidence-mode CVE artifact formatters (CVE scan loop — design/15 §7/§8). Assemble matches + applicability +
 * coverage into the §3 markdown the model presents verbatim (`formatCveScanReport`) AND the structured
 * `cve-scan-<date>.json` evidence artifact (`formatCveScanJson`) — the two §7 deliverables, built from the SAME
 * input so they can never disagree. Strictly evidence-mode: every claim is **attributed** (OSV) + **dated**
 * (as-of) + **hedged** (verify); coverage is reported honestly and the no-match case is NEVER framed as "clean".
 * Both outputs are self-checked by `verdictScan` in the tests. Pure; `asOf` is injected (no Date.now here).
 */
import type { ApplicabilityVerdict } from "./applicability"
import type { EuvdRecord } from "./euvdFetcher"
import type { EnrichedVuln } from "./osvEnrich"
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
	/** Optional severity/fixed-version enrichment, keyed by vuln id (§4/§11). Surfaced verbatim + attributed. */
	enrichment?: Map<string, EnrichedVuln>
	/** EU Vulnerability Database (EUVD) confirmation, keyed by CVE id — the CRA's named source (a CORE source, not
	 *  an opt-in): the EUVD id + EPSS + KEV/exploited flag. Sourced facts, never a verdict. The `?` is just "no
	 *  EUVD data to render this run" (a pure-formatter input) — absent → nothing rendered. */
	euvd?: Map<string, EuvdRecord>
	/** EUVD discover-by-product CANDIDATES (not version-matched by OSV/NVD) — the EU-authoritative catch for CVEs
	 *  NVD's CPE configs miss, surfaced as a hedged "version not auto-confirmed; verify" list. Core; `?` = none this run.
	 *  design/28: each may carry an `applicability` verdict (from a curated hint + build evidence) — a reachable one
	 *  (config-present / linked) is surfaced FIRST, above the cap, so a hero CVE like CVE-2025-10456 isn't buried. */
	euvdCandidates?: Array<EuvdRecord & { applicability?: ApplicabilityVerdict }>
	/** Label for that candidate set, e.g. "zephyr 4.2.99". */
	euvdProductLabel?: string
	/** T3 (design/25): set when the SBOM file was non-empty but parsed to 0 components — almost always the WRONG
	 *  file (not SPDX, or `app.spdx` with no ids), not a clean result. Rendered as a prominent warning so "0
	 *  queryable" is never mistaken for "0 vulnerabilities". Absent → normal. */
	sbomParseWarning?: string
	/** Per-source raw return counts (design/28) — the "what each DB returned" brief for the interactive Phase-2
	 *  view. Facts, not a verdict. Absent → the sources line is omitted. */
	sources?: { osv: number; nvd: number; euvdProduct: number; euvdConfirmed: number }
	/** Per-source availability (design/28 graceful degradation). A wired source that FAILED is "unavailable" → the
	 *  report renders a PARTIAL scan ("<source> didn't run — NOT a clean result"). `undefined` = source not wired. */
	sourceStatus?: { osv?: "ok" | "unavailable"; nvd?: "ok" | "unavailable" }
}

/** Max EUVD discover-by-product candidates rendered inline (the rest summarised as "+N more"). */
const EUVD_CANDIDATE_CAP = 10

const advisoryUrl = (id: string) => `https://osv.dev/vulnerability/${id}`

/** Reason breakdown of the skipped set — the single derivation md + json both render (they can't disagree). */
function dropReasonCounts(skipped: SkippedComponent[]): Partial<Record<DropReason, number>> {
	const counts: Partial<Record<DropReason, number>> = {}
	for (const s of skipped) {
		counts[s.reason] = (counts[s.reason] ?? 0) + 1
	}
	return counts
}

/**
 * Triage funnel counts (host-derived, never a verdict). "Not reachable" = the build evidence excludes the
 * affected code (config-gated-out OR not-linked); everything else is "review" (linked = weak/may-be-reachable,
 * unknown = no signal). Both md + json render from this single derivation so they can't disagree.
 */
function summarizeTriage(findings: ScanFinding[]): { total: number; notReachable: number; review: number } {
	let notReachable = 0
	for (const f of findings) {
		const s = f.applicability.signal
		// Excluded by build evidence: gated-out, stripped (not-linked), patched in the tree (fix-present, P2), OR
		// the build's version is past the fix (version-fixed, design/32).
		if (s === "not-linked" || s === "config-gated-out" || s === "fix-present" || s === "version-fixed") {
			notReachable++
		}
	}
	return { total: findings.length, notReachable, review: findings.length - notReachable }
}

/**
 * The shared data-provenance caption (NOT a legal disclaimer — reuses the advisories "as of" shape, §8.1).
 * design/25 T4: this hedge wording is the HOST's home-of-record — the model presents it verbatim (anti-fabrication,
 * D11-R), so the bit must NOT restate it (the bit says "present the host's caption verbatim"). Edit it HERE.
 */
const provenanceCaption = (source: string, asOf: string): string =>
	`${source} matches for your SBOM's component versions, as of ${asOf}. Partial coverage; ` +
	"version-matching can over- or under-report — open each linked advisory to confirm it applies to your build."

/**
 * The EUVD discover-by-product candidates section (hedged, capped, high-severity-first). Separate from the
 * version-matched findings BECAUSE EUVD has no machine version-ranges — these are "the EU DB lists this for your
 * component; applicability to your exact build is not auto-determined; verify". Evidence-mode (CVSS/EPSS/KEV are
 * sourced facts), every line ends in "verify". Empty when there are no candidates.
 */
/** The id · CVSS · EPSS · KEV fact bits for one EUVD candidate (sourced facts, never a verdict). */
function euvdBits(c: EuvdRecord): string {
	const bits = [`[${c.cveId}](https://euvd.enisa.europa.eu) (${c.euvdId})`]
	if (c.baseScore != null) {
		bits.push(`CVSS ${c.baseScore}`)
	}
	if (c.epss != null) {
		bits.push(`EPSS ${Math.round(c.epss * 100)}%`)
	}
	if (c.exploited) {
		bits.push("flagged actively exploited (KEV)")
	}
	return bits.join(" · ")
}

function renderEuvdCandidates(input: EvidenceReportInput): string[] {
	const all = input.euvdCandidates ?? []
	// P2 + design/32: a candidate already patched — its upstream fix is in the tree (fix-present) OR the build's
	// version is past the fix (version-fixed) — is dropped from the "to verify" list (it stays in the JSON for the
	// record). Note the count so the omission is transparent.
	const isPatched = (c: { applicability?: ApplicabilityVerdict }) =>
		c.applicability?.signal === "fix-present" || c.applicability?.signal === "version-fixed"
	const patched = all.filter(isPatched).length
	const cands = all.filter((c) => !isPatched(c))
	if (cands.length === 0 && patched === 0) {
		return []
	}
	// design/28: a candidate the build evidence makes REACHABLE (a curated hint → config-present / linked) is the
	// signal worth the dev's attention — surface it FIRST and ALWAYS (above the EPSS cap) so a hero like
	// CVE-2025-10456 isn't buried. The rest stay EPSS-first (design/25 T6), capped.
	const isReachable = (c: { applicability?: ApplicabilityVerdict }) =>
		c.applicability?.signal === "config-present" || c.applicability?.signal === "linked"
	const byEpss = (a: EuvdRecord, b: EuvdRecord) => (b.epss ?? 0) - (a.epss ?? 0) || (b.baseScore ?? 0) - (a.baseScore ?? 0)
	const reachable = [...cands].filter(isReachable).sort(byEpss)
	const rest = [...cands].filter((c) => !isReachable(c)).sort(byEpss)
	const shownRest = rest.slice(0, EUVD_CANDIDATE_CAP)
	const label = input.euvdProductLabel ? ` for ${input.euvdProductLabel}` : ""
	const upgradeTarget = input.euvdProductLabel ? input.euvdProductLabel.split(" ")[0] : "the SDK"

	const out: string[] = [
		"",
		`## Additional EU Vulnerability Database advisories${label} (version not auto-confirmed — verify)`,
		"",
		"> The EU Vulnerability Database (EUVD) lists these for this component, but does not publish machine-readable " +
			"version ranges — so applicability to YOUR exact build is not auto-determined. Open each and verify.",
		"",
	]
	if (reachable.length > 0) {
		out.push("Likely reachable in your build (build evidence) — verify + act first:")
		for (const c of reachable) {
			const note = c.applicability?.note ?? "may be reachable; verify."
			out.push(
				`- ${euvdBits(c)} — ${note} Mitigate: upgrade ${upgradeTarget} past the fix, then re-scan to confirm it cleared.`,
			)
		}
		out.push("")
		if (rest.length > 0) {
			out.push("Other advisories to verify (version not auto-confirmed):")
		}
	}
	for (const c of shownRest) {
		out.push(`- ${euvdBits(c)} — verify whether it applies to your build.`)
	}
	if (rest.length > shownRest.length) {
		out.push(`- … +${rest.length - shownRest.length} more in the EU DB (open the EUVD for the full list).`)
	}
	if (patched > 0) {
		out.push(
			"",
			`(${patched} further EUVD advisor${patched === 1 ? "y" : "ies"} — the upstream fix commit is present in your source tree, so very likely already covered — omitted here; see the JSON.)`,
		)
	}
	return out
}

export function formatCveScanReport(input: EvidenceReportInput): string {
	const source = input.source ?? "OSV"
	const counts = dropReasonCounts(input.skipped)
	const cpeOnly = counts["cpe-only"] ?? 0
	const noId = counts["no-id"] ?? 0
	const noVersion = counts["no-version"] ?? 0

	const lines: string[] = [`## CVE scan — ${source}, as of ${input.asOf}`, "", `> ${provenanceCaption(source, input.asOf)}`, ""]

	// T3: a non-empty SBOM that parsed to 0 components is almost certainly the WRONG file — surface it loudly so
	// the "0 queryable" below is never read as "0 vulnerabilities / clean".
	if (input.sbomParseWarning) {
		lines.push(`> Note — ${input.sbomParseWarning}`, "")
	}

	// design/28: a wired source that FAILED → loud PARTIAL-scan banner so absent findings are never read as clean.
	const downSources = [
		input.sourceStatus?.nvd === "unavailable" ? "NVD" : null,
		input.sourceStatus?.osv === "unavailable" ? "OSV" : null,
	].filter(Boolean)
	if (downSources.length > 0) {
		lines.push(
			`> PARTIAL SCAN — ${downSources.join(" + ")} did not run this scan (timed out / unreachable / rate-limited). ` +
				"Coverage is INCOMPLETE — this is NOT a clean result; re-run to include it. Absent findings here do not mean none exist.",
			"",
		)
	}

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

	// design/28: the per-source "what each DB returned" brief (facts, never a verdict). Version-matched lane
	// (NVD by CPE + OSV by PURL → findings, EUVD-confirmed) is kept distinct from EUVD discover-by-product leads.
	if (input.sources) {
		const s = input.sources
		const nvdCell = input.sourceStatus?.nvd === "unavailable" ? "unavailable (re-run)" : `${s.nvd}`
		const osvCell = input.sourceStatus?.osv === "unavailable" ? "unavailable (re-run)" : `${s.osv}`
		lines.push(
			`Sources queried (as of ${input.asOf}): NVD by CPE ${nvdCell} · OSV by PURL ${osvCell} → ${input.findings.length} version-matched findings` +
				` (EUVD-confirmed ${s.euvdConfirmed}); EU Vulnerability Database (ENISA) by product ${s.euvdProduct} additional advisories to verify.`,
			"",
		)
	}

	if (input.findings.length === 0) {
		lines.push(
			`No ${source} matches as of ${input.asOf} for the ${input.queriedCount} queryable components. ` +
				"This is not a complete check — components without an identifier were not scanned; open the live advisories to confirm.",
		)
		lines.push(...renderEuvdCandidates(input)) // EUVD discover-by-product may still have candidates to verify
		return lines.join("\n")
	}

	// Triage funnel (host-derived counts, never a verdict): how many advisories the build evidence makes
	// likely-not-reachable vs still-to-review. Only shown once the evidence actually triaged something, so we
	// never imply an applicability pass that didn't run. "Likely not reachable" stays hedged — verify is the rule.
	const triage = summarizeTriage(input.findings)
	if (triage.notReachable > 0) {
		lines.push(
			`Triage (from your build evidence): ${triage.total} advisories — ${triage.notReachable} likely not ` +
				`reachable in your build (verify) · ${triage.review} to review.`,
			"",
		)
	}

	for (const f of input.findings) {
		const c = f.match.component
		const idLinks = f.match.vulnIds.map((id) => `[${id}](${advisoryUrl(id)})`).join(", ")
		let line = `- **${c.name}@${c.version}** — ${source} reports ${idLinks} (as of ${input.asOf}). ${f.applicability.note}`
		// Enrichment (findings are per-id): surface OSV's CVSS vector + fixed version VERBATIM, attributed + dated.
		const enr = input.enrichment?.get(f.match.vulnIds[0])
		if (enr) {
			if (enr.severities.length > 0) {
				line += ` ${source} severity: ${enr.severities.map((s) => `${s.type} ${s.score}`).join("; ")}.`
			}
			if (enr.fixedVersions.length > 0) {
				line += ` ${source} reports fixed in ${enr.fixedVersions.join(" / ")} (as of ${input.asOf}) — verify against your build.`
			}
		}
		// EUVD confirmation (the CRA's named DB): the EUVD id + EPSS + KEV — sourced facts, hedged, never a verdict.
		const ev = input.euvd?.get(f.match.vulnIds[0])
		if (ev?.euvdId) {
			line += ` EU Vulnerability Database: ${ev.euvdId}`
			if (ev.epss != null) {
				line += `, EPSS ${Math.round(ev.epss * 100)}% (exploit-likelihood, as of ${input.asOf})`
			}
			if (ev.exploited) {
				line += `, flagged actively exploited (KEV)`
			}
			line += ` — verify against your build.`
		}
		lines.push(line)
	}
	lines.push(...renderEuvdCandidates(input)) // EU-authoritative discover-by-product candidates (hedged, capped)
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
	/** Per-source raw return counts (design/28) — what each DB returned. Present only when the scan provided them. */
	sources?: { osv: number; nvd: number; euvdProduct: number; euvdConfirmed: number }
	/** Triage funnel mirror (host-derived counts): total advisories, likely-not-reachable, to-review. */
	triage: { total: number; notReachable: number; review: number }
	findings: Array<{
		component: string
		version: string
		/** Per advisory: id + url, plus OSV-verbatim severities (CVSS vectors) + fixed versions when enriched, plus
		 *  the EUVD confirmation (EU Vulnerability Database id + EPSS + KEV flag) when present. */
		advisories: Array<{
			id: string
			url: string
			severities: OsvSeverityJson[]
			fixedVersions: string[]
			euvd?: { id: string; epss: number | null; exploited: boolean; references: string[] }
		}>
		/** Applicability is an EXCLUSION signal + a hedged note ending in "verify" — never a conformity verdict. */
		applicability: { signal: ApplicabilityVerdict["signal"]; note: string }
	}>
	skipped: Array<{ component: string; version: string; reason: DropReason }>
	/** EUVD discover-by-product candidates (present only when found) — the EU-authoritative list for the detected
	 *  SDK that NVD's CPE may miss; NOT version-confirmed (EUVD has no ranges), so hedged + "verify". */
	euvdCandidates?: Array<{
		id: string
		euvdId: string
		baseScore: number | null
		epss: number | null
		exploited: boolean
		/** Applicability when a curated hint + build evidence assessed it (design/28); omitted when "unknown". */
		applicability?: { signal: ApplicabilityVerdict["signal"]; note: string }
	}>
}

interface OsvSeverityJson {
	type: string
	score: string
}

export function formatCveScanJson(input: EvidenceReportInput): string {
	const source = input.source ?? "OSV"
	const doc: CveScanJson = {
		schema: "adsum.cve-scan/1",
		source,
		asOf: input.asOf,
		provenance: provenanceCaption(source, input.asOf),
		coverage: { queryable: input.queriedCount, byDropReason: dropReasonCounts(input.skipped) },
		...(input.sources ? { sources: input.sources } : {}),
		triage: summarizeTriage(input.findings),
		findings: input.findings.map((f) => ({
			component: f.match.component.name,
			version: f.match.component.version,
			advisories: f.match.vulnIds.map((id) => {
				const enr = input.enrichment?.get(id)
				const ev = input.euvd?.get(id)
				return {
					id,
					url: advisoryUrl(id),
					severities: enr?.severities ?? [],
					fixedVersions: enr?.fixedVersions ?? [],
					...(ev?.euvdId
						? { euvd: { id: ev.euvdId, epss: ev.epss ?? null, exploited: ev.exploited, references: ev.references } }
						: {}),
				}
			}),
			applicability: { signal: f.applicability.signal, note: f.applicability.note },
		})),
		skipped: input.skipped.map((s) => ({ component: s.component.name, version: s.component.version, reason: s.reason })),
		// Additive: only present when discover-by-product found candidates → existing JSON output is unchanged otherwise.
		...(input.euvdCandidates?.length
			? {
					euvdCandidates: input.euvdCandidates.map((c) => ({
						id: c.cveId,
						euvdId: c.euvdId,
						baseScore: c.baseScore ?? null,
						epss: c.epss ?? null,
						exploited: c.exploited,
						// Only emit applicability when a hint actually assessed it (signal !== "unknown") — keeps the JSON honest.
						...(c.applicability && c.applicability.signal !== "unknown"
							? { applicability: { signal: c.applicability.signal, note: c.applicability.note } }
							: {}),
					})),
				}
			: {}),
	}
	return JSON.stringify(doc, null, 2)
}
