/**
 * CVE scan orchestrator (design/15 §3–§8). Composes the substrate end-to-end into the one host-side call the
 * operator spike exercises and the host→model channel (spike-gated, not wired here) will later invoke:
 *
 *   normalizeSbom → scanWithOsv (injected fetcher) → assessApplicability (per CVE) → formatCveScanReport
 *
 * Every impurity is injected — the network `fetcher`, the `asOf` date, and the `resolveHint` lookup (the curated
 * cra-advisories map). With no resolver, every match is honestly "unknown" (we never invent applicability). The
 * function is otherwise pure + deterministic + fixture-testable; it adds NO runtime fence change and shapes NO
 * model content (D11-R: the host observes/correlates; the model never fabricates a CVE).
 *
 * Honesty design — ONE finding per (component, vulnId), NOT per component. Distinct CVEs on one component have
 * distinct affected code; collapsing them to a single "strongest exclusion" note could mask a reachable CVE
 * behind a gated-out sibling. Per-CVE findings keep each verdict faithful and match how the advisory map is keyed.
 */
import { type ApplicabilityHint, assessApplicability, type BuildEvidence } from "./applicability"
import { applyCuratedPurls, type ModuleVersionResolver } from "./componentPurlMap"
import { type EvidenceReportInput, formatCveScanJson, formatCveScanReport, type ScanFinding } from "./evidenceReport"
import { type EnrichedVuln, enrichVulns, type OsvVulnFetcher } from "./osvEnrich"
import { type OsvFetcher, type OsvMatch, type SkippedComponent, scanWithOsv } from "./osvMatch"
import { type NormalizedSbom, normalizeSbom, type SbomComponent, type SbomCoverage } from "./sbomNormalize"

/** Curated applicability lookup: (CVE/OSV id, component) → hint, or undefined → honest "unknown". */
export type HintResolver = (vulnId: string, component: SbomComponent) => ApplicabilityHint | undefined

export interface ScanLoopInput {
	/** Raw SPDX (tag-value or JSON) from `west ncs-sbom` / `esp-idf-sbom`. */
	spdxText: string
	/** The build's own evidence (merged .config, ELF symbol dump) — drives applicability. */
	evidence: BuildEvidence
	/** ISO date (e.g. "2026-06-25"), injected — no Date.now in pure code. */
	asOf: string
	/** The only network touch — host-side POST to OSV querybatch (injected for tests). */
	fetcher: OsvFetcher
	/** Curated per-CVE hint lookup; omitted → every match is "unknown" (honest default). */
	resolveHint?: HintResolver
	source?: string
	/**
	 * Optional NCS-module version source (west.yml / a per-release table). When provided, the curated
	 * component→PURL map fills missing PURLs (a version + a verified coordinate → a queryable PURL), raising
	 * coverage on PURL-sparse NCS SBOMs. Omitted → the map is not applied (default behaviour unchanged).
	 */
	resolveModuleVersion?: ModuleVersionResolver
	/**
	 * Optional severity/fixed-version enrichment (§4/§11). When provided, each matched vuln is fetched and its
	 * CVSS vector + fixed version are surfaced verbatim. Omitted → no enrichment (and no extra network calls).
	 */
	vulnFetcher?: OsvVulnFetcher
}

export interface ScanLoopResult {
	/** The §3 evidence-mode markdown — verdict-clean, presented verbatim by the model. */
	report: string
	/** The §7 structured `cve-scan-<date>.json` artifact — same data as `report`, machine-readable. */
	json: string
	/** One per (component, vulnId), each independently assessed. */
	findings: ScanFinding[]
	/** PURL/CPE/unidentified counts from the normalizer (honest coverage). */
	coverage: SbomCoverage
	/** Components left out of the OSV query, with the honest reason. */
	skipped: SkippedComponent[]
	queriedCount: number
	normalized: NormalizedSbom
	/** Severity/fixed enrichment keyed by vuln id (empty unless a `vulnFetcher` was provided). */
	enrichment: Map<string, EnrichedVuln>
}

/** Run the full scan loop. Deterministic given a fixed fetcher + asOf; the only network touch is `fetcher`. */
export async function runCveScan(input: ScanLoopInput): Promise<ScanLoopResult> {
	const parsed = normalizeSbom(input.spdxText)
	// Curated map (opt-in): fill missing PURLs from a verified coordinate + an operator-supplied version.
	const normalized = input.resolveModuleVersion ? applyCuratedPurls(parsed, input.resolveModuleVersion) : parsed
	// Pass ALL components (not queryableComponents) so planOsvScan keeps the cpe-only / no-identifier skip records.
	const scan = await scanWithOsv(normalized.components, input.fetcher)
	const resolve = input.resolveHint ?? (() => undefined)

	const findings: ScanFinding[] = []
	for (const m of scan.matches) {
		for (const id of m.vulnIds) {
			const singleMatch: OsvMatch = { component: m.component, vulnIds: [id] }
			findings.push({ match: singleMatch, applicability: assessApplicability(resolve(id, m.component), input.evidence) })
		}
	}

	// Optional enrichment: only touches the network when a vulnFetcher is provided.
	const enrichment = input.vulnFetcher
		? await enrichVulns(
				findings.map((f) => f.match.vulnIds[0]),
				input.vulnFetcher,
			)
		: new Map<string, EnrichedVuln>()

	const reportInput: EvidenceReportInput = {
		findings,
		skipped: scan.skipped,
		queriedCount: scan.queriedCount,
		asOf: input.asOf,
		source: input.source,
		enrichment,
	}
	return {
		report: formatCveScanReport(reportInput),
		json: formatCveScanJson(reportInput),
		findings,
		coverage: normalized.coverage,
		skipped: scan.skipped,
		queriedCount: scan.queriedCount,
		normalized,
		enrichment,
	}
}
