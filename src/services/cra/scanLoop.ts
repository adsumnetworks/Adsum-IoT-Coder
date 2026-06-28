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
import { applyCuratedCpes, applyCuratedPurls, type ModuleVersionResolver } from "./componentPurlMap"
import { type EuvdFetcher, type EuvdRecord, enrichWithEuvd } from "./euvdFetcher"
import { type EvidenceReportInput, formatCveScanJson, formatCveScanReport, type ScanFinding } from "./evidenceReport"
import { applyModuleRefs, type ModuleRefsResolver } from "./moduleSecurityRefs"
import { type NvdFetcher, scanWithNvd } from "./nvdMatch"
import { type EnrichedVuln, enrichVulns, type OsvVulnFetcher } from "./osvEnrich"
import { type OsvFetcher, type SkippedComponent, scanWithOsv } from "./osvMatch"
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
	 * Optional `zephyr/module.yml` security-refs lookup (F5). When provided, components missing a CPE/PURL are
	 * filled from each module's own declarations — so the CPE→NVD path works even when the SBOM tool didn't emit
	 * CPEs (older `ncs-sbom`). Omitted → no module.yml enrichment.
	 */
	resolveModuleRefs?: ModuleRefsResolver
	/**
	 * Optional platform-core SEMVER resolver (e.g. zephyr/VERSION → "4.2.99"). When provided, the curated CPE map
	 * fills a CPE on the cores the SBOM tool omits (Zephyr, MCUboot) so the CPE→NVD path detects their CVEs. Must
	 * yield a semver, NOT the git SHA the SBOM records. Omitted → no core-CPE enrichment.
	 */
	resolveCoreVersion?: ModuleVersionResolver
	/**
	 * Optional severity/fixed-version enrichment (§4/§11). When provided, each matched vuln is fetched and its
	 * CVSS vector + fixed version are surfaced verbatim. Omitted → no enrichment (and no extra network calls).
	 */
	vulnFetcher?: OsvVulnFetcher
	/**
	 * Optional CPE→NVD fetcher (F11). When provided, components bearing a CPE are ALSO queried against NVD —
	 * the path that finds CVEs for the embedded C libs OSV doesn't index by PURL (mbed TLS et al.). Omitted →
	 * no NVD path (default behaviour unchanged, no extra network).
	 */
	nvdFetcher?: NvdFetcher
	/**
	 * EUVD confirmation fetcher — the CRA's named database, a CORE source (NOT an operational opt-in): each matched
	 * CVE is looked up in the EU Vulnerability Database → its EUVD id + EPSS + KEV flag surfaced. The `?` is a
	 * unit-test injection seam only (like nvdFetcher/vulnFetcher); production wires it UNCONDITIONALLY. Per-id
	 * failures degrade (never fail the scan / never a false clean).
	 */
	euvdFetcher?: EuvdFetcher
	/**
	 * EUVD discover-by-product source — the EU-authoritative list for the detected SDK (e.g. zephyr) that catches
	 * CVEs NVD's CPE configs miss. CORE for a CRA scan; production wires it for every detected platform (the `?` is
	 * the test seam). EUVD has no version ranges, so these are surfaced SEPARATELY as hedged "version not
	 * auto-confirmed; verify" candidates (deduped against the version-matched findings), never as confirmed matches.
	 */
	euvdProductFetcher?: () => Promise<EuvdRecord[]>
	/** Human label for the discover-by-product set, e.g. "zephyr 4.2.99". */
	euvdProductLabel?: string
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
	/** Per-source raw return counts (the "what each DB returned" brief) — for the interactive Phase-2 view. */
	sources: { osv: number; nvd: number; euvdProduct: number; euvdConfirmed: number }
}

/** Run the full scan loop. Deterministic given a fixed fetcher + asOf; the only network touch is `fetcher`. */
export async function runCveScan(input: ScanLoopInput): Promise<ScanLoopResult> {
	const parsed = normalizeSbom(input.spdxText)
	// Curated map (opt-in): fill missing PURLs from a verified coordinate + an operator-supplied version.
	let normalized = input.resolveModuleVersion ? applyCuratedPurls(parsed, input.resolveModuleVersion) : parsed
	// module.yml refs (F5, opt-in): fill CPE/PURL the SBOM tool didn't emit, from the modules' own declarations.
	if (input.resolveModuleRefs) {
		normalized = applyModuleRefs(normalized, input.resolveModuleRefs)
	}
	// Curated CPE map (opt-in): give the platform cores (Zephyr, MCUboot) the CPE west spdx omits, keyed on an
	// SDK-resolved semver — so the CPE→NVD path below can detect their CVEs (Zephyr is otherwise undetectable).
	if (input.resolveCoreVersion) {
		normalized = applyCuratedCpes(normalized, input.resolveCoreVersion)
	}
	// Pass ALL components (not queryableComponents) so planOsvScan keeps the cpe-only / no-identifier skip records.
	const osvScan = await scanWithOsv(normalized.components, input.fetcher)
	// CPE→NVD (F11, opt-in): query the components OSV can't reach — embedded C libs keyed by CPE, not PURL.
	const nvdScan = input.nvdFetcher
		? await scanWithNvd(normalized.components, input.nvdFetcher)
		: { matches: [], skipped: [], queriedCount: 0 }
	const resolve = input.resolveHint ?? (() => undefined)

	// ONE finding per (component, vulnId), deduped across both sources (a CVE can surface in OSV AND NVD).
	const findings: ScanFinding[] = []
	const seen = new Set<string>()
	const addFinding = (component: SbomComponent, id: string) => {
		const key = `${component.name}@${component.version}::${id}`
		if (seen.has(key)) {
			return
		}
		seen.add(key)
		findings.push({
			match: { component, vulnIds: [id] },
			applicability: assessApplicability(resolve(id, component), input.evidence),
		})
	}
	for (const m of osvScan.matches) {
		for (const id of m.vulnIds) {
			addFinding(m.component, id)
		}
	}
	for (const m of nvdScan.matches) {
		for (const v of m.vulns) {
			addFinding(m.component, v.id)
		}
	}

	// Coverage when the NVD path ran: a CPE-bearing component is now queryable (it was "cpe-only" → skipped
	// under OSV-only). Credit it honestly — skipped shrinks to the truly unidentified; queriedCount counts
	// components with a PURL OR a CPE. Without the NVD path, coverage is exactly as before.
	const nvdRan = !!input.nvdFetcher
	const skipped = nvdRan ? osvScan.skipped.filter((s) => !s.component.cpe) : osvScan.skipped
	const queriedCount = nvdRan ? normalized.components.filter((c) => c.purl || c.cpe).length : osvScan.queriedCount

	// Optional enrichment: only touches the network when a vulnFetcher is provided.
	const enrichment = input.vulnFetcher
		? await enrichVulns(
				findings.map((f) => f.match.vulnIds[0]),
				input.vulnFetcher,
			)
		: new Map<string, EnrichedVuln>()

	// Optional EUVD confirmation: only touches the network when an euvdFetcher is provided; per-id failures degrade.
	const euvd = input.euvdFetcher
		? await enrichWithEuvd(
				findings.flatMap((f) => f.match.vulnIds),
				input.euvdFetcher,
			)
		: new Map<string, EuvdRecord>()

	// EUVD discover-by-product (opt-in): the EU-authoritative list for the detected SDK. Surface ONLY the ones not
	// already version-matched by OSV/NVD, as hedged "version-not-confirmed" candidates (never as confirmed matches).
	const foundIds = new Set(findings.flatMap((f) => f.match.vulnIds.map((id) => id.toUpperCase())))
	const euvdProduct = input.euvdProductFetcher ? await input.euvdProductFetcher() : []
	const euvdCandidates = euvdProduct.filter((c) => !foundIds.has(c.cveId.toUpperCase()))

	// T3 (design/25): a non-empty SBOM that normalized to 0 components is almost always the WRONG file (not SPDX,
	// or `app.spdx` with no ids) — not a clean result. Surface it so "0 queryable" is never read as "0 CVEs".
	const sbomParseWarning =
		input.spdxText.trim().length > 0 && parsed.components.length === 0
			? "the SBOM file was not empty but no components were parsed from it — this usually means it is not an SPDX " +
				"file (tag-value or JSON) or is the wrong file (e.g. app.spdx with no identifiers). This is NOT a clean " +
				"result; regenerate/point at the CPE/PURL-bearing SBOM (modules-deps.spdx or all.spdx) and re-scan."
			: undefined

	// Per-source counts — the honest "what each DB returned" brief for the interactive Phase-2 presentation
	// (design/28). Raw per-source returns (may overlap across sources before dedup); `findings` is the merged set.
	const sources = {
		osv: osvScan.matches.reduce((n, m) => n + m.vulnIds.length, 0),
		nvd: nvdScan.matches.reduce((n, m) => n + m.vulns.length, 0),
		euvdProduct: euvdProduct.length, // EUVD discover-by-product advisories (leads, version-not-confirmed)
		euvdConfirmed: euvd.size, // matched CVEs also confirmed in the EU Vulnerability Database
	}

	// D1 (design/25): the source attribution must reflect what ACTUALLY ran, not a hard-coded string. OSV always
	// runs (fetcher is required); NVD/EUVD only when their fetcher is wired. An explicit input.source still wins.
	const source =
		input.source ??
		[input.euvdFetcher || input.euvdProductFetcher ? "EUVD" : null, input.nvdFetcher ? "NVD" : null, "OSV"]
			.filter(Boolean)
			.join(" + ")

	const reportInput: EvidenceReportInput = {
		findings,
		skipped,
		queriedCount,
		asOf: input.asOf,
		source,
		enrichment,
		euvd,
		euvdCandidates,
		euvdProductLabel: input.euvdProductLabel,
		sbomParseWarning,
		sources,
	}
	return {
		report: formatCveScanReport(reportInput),
		json: formatCveScanJson(reportInput),
		findings,
		coverage: normalized.coverage,
		skipped,
		queriedCount,
		normalized,
		enrichment,
		sources,
	}
}
