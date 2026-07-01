/**
 * Host orchestration for the CVE scan (CVE scan loop — design/15). The one entry the model-facing channel (the
 * TriggerCveScan handler) and the operator spike both call: read the SBOM + the build evidence, run the
 * deterministic scan loop, return the §3 markdown + §7 JSON. Every side-effecting dependency is injected
 * (network, fs, `nm`, the as-of date, the curated hint map) so this stays unit-testable with no real build/network.
 *
 * D11-R: the host owns the scan; this module produces the evidence the model PRESENTS — the model never
 * fabricates a CVE. Risk mitigations:
 *  - **No SBOM** → throw a clear error (the caller tells the user to run the SBOM step first); we never emit a
 *    "no vulnerabilities" result from a missing SBOM (that would read as a clean bill of health it isn't).
 *  - **Empty/garbage SBOM** → normalizeSbom yields 0 components → the report's honest "not a complete check"
 *    path fires; coverage shows 0 queryable (never framed as "clean").
 */

import type { BuildEvidenceReaders } from "./buildEvidence"
import { readBuildEvidence } from "./buildEvidence"
import type { ModuleVersionResolver } from "./componentPurlMap"
import type { EuvdFetcher, EuvdRecord } from "./euvdFetcher"
import type { ModuleRefsResolver } from "./moduleSecurityRefs"
import type { NvdFetcher } from "./nvdMatch"
import type { OsvVulnFetcher } from "./osvEnrich"
import type { OsvFetcher } from "./osvMatch"
import type { HintResolver } from "./scanLoop"
import { runCveScan, type ScanLoopResult } from "./scanLoop"

export interface CveScanHostDeps {
	/** Host-side OSV network call (the only network touch). */
	fetcher: OsvFetcher
	/** fs + nm readers for the build evidence (and the SBOM file, if read by path). */
	readers: BuildEvidenceReaders
	/** ISO date stamped onto every attribution — injected (the CLI/handler passes today; the core stays pure). */
	asOf: string
	/** Curated CVE→hint resolver; omitted → every match is honestly "unknown". */
	resolveHint?: HintResolver
	source?: string
	/** Optional severity/fixed enrichment fetcher (§4/§11); omitted → no enrichment, no extra network calls. */
	vulnFetcher?: OsvVulnFetcher
	/** Optional NCS-module version source; when provided, the curated PURL map fills missing PURLs (§5). */
	resolveModuleVersion?: ModuleVersionResolver
	/** Optional zephyr/module.yml security-refs lookup (F5); fills CPE/PURL the SBOM tool didn't emit. */
	resolveModuleRefs?: ModuleRefsResolver
	/** Optional platform-core semver resolver (zephyr/VERSION → "4.2.99"); enables curated-CPE detection of the
	 *  cores (Zephyr/MCUboot) the SBOM tool omits. Must be a semver, not the git SHA. */
	resolveCoreVersion?: ModuleVersionResolver
	/** Optional CPE→NVD fetcher (F11); when provided, CPE-bearing components are also scanned against NVD. */
	nvdFetcher?: NvdFetcher
	/** EUVD confirmation fetcher — the CRA's named database, a CORE source (the `?` is a test seam; production wires
	 *  it unconditionally). Matched CVEs are confirmed against the EU Vulnerability Database → EUVD id + EPSS + KEV.
	 *  Per-id failures degrade. */
	euvdFetcher?: EuvdFetcher
	/** EUVD discover-by-product source for the detected SDK (the CRA-authoritative catch for CVEs NVD's CPE misses).
	 *  Surfaced as hedged "version not auto-confirmed" candidates. Core; production wires it per detected platform. */
	euvdProductFetcher?: () => Promise<EuvdRecord[]>
	/** Label for the discover-by-product set, e.g. "zephyr 4.2.99". */
	euvdProductLabel?: string
	/** P2 (design/30): platform-neutral fix-commit-in-tree check (handler binds it to `git merge-base
	 *  --is-ancestor` in the detected SDK's source tree). A backported fix → the CVE is excluded as "fix-present". */
	fixCommitChecker?: (fixSha: string) => Promise<boolean | undefined>
	/** P2 auto-discovery (design/30): CVE → upstream fix-commit SHA from OSV's GIT range (when not curated). */
	fixCommitResolver?: (cveId: string) => Promise<string | undefined>
}

export interface CveScanHostInput {
	/** Raw SPDX text — provide this OR `sbomPath`. */
	sbomText?: string
	/** Path to the SBOM file (read via `readers.readText`) — used when `sbomText` is not provided. */
	sbomPath?: string
	/** The verified build dir, for applicability evidence (merged .config + ELF symbols). Optional. */
	buildDir?: string
	dotConfigPath?: string
	elfPath?: string
	/** Pre-computed `nm` symbol-dump path (design/34 Sample bundle) — read as text, no `nm` run. */
	symbolsPath?: string
}

export async function runCveScanHost(input: CveScanHostInput, deps: CveScanHostDeps): Promise<ScanLoopResult> {
	const spdxText = input.sbomText ?? (input.sbomPath ? deps.readers.readText(input.sbomPath) : undefined)
	if (spdxText === undefined) {
		throw new Error(
			input.sbomPath
				? `Could not read the SBOM at ${input.sbomPath} — generate an SBOM first, then scan.`
				: "No SBOM provided — generate an SBOM first, then scan.",
		)
	}
	const evidence = readBuildEvidence(
		{
			buildDir: input.buildDir,
			dotConfigPath: input.dotConfigPath,
			elfPath: input.elfPath,
			symbolsPath: input.symbolsPath,
		},
		deps.readers,
	)
	return runCveScan({
		spdxText,
		evidence,
		asOf: deps.asOf,
		fetcher: deps.fetcher,
		resolveHint: deps.resolveHint,
		source: deps.source,
		vulnFetcher: deps.vulnFetcher,
		resolveModuleVersion: deps.resolveModuleVersion,
		resolveModuleRefs: deps.resolveModuleRefs,
		resolveCoreVersion: deps.resolveCoreVersion,
		nvdFetcher: deps.nvdFetcher,
		euvdFetcher: deps.euvdFetcher,
		euvdProductFetcher: deps.euvdProductFetcher,
		euvdProductLabel: deps.euvdProductLabel,
		fixCommitChecker: deps.fixCommitChecker,
		fixCommitResolver: deps.fixCommitResolver,
	})
}
