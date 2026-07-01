/**
 * Curated component→PURL map (CVE scan loop — design/15 §5; the design/16 Fact-1 remedy). A real `west spdx`
 * NCS SBOM is PURL-sparse (measured 2026-06-25: 3/44 in modules-deps, 0/91 in build) and carries **no
 * PackageVersion** at all — versions live only in the few embedded PURLs. So raising nRF coverage needs TWO
 * curated halves, both honest:
 *
 *   1. NAME → canonical PURL **coordinate** (this file) — stable, public-repo facts (e.g. mbedtls →
 *      pkg:github/Mbed-TLS/mbedtls). A WRONG coordinate produces WRONG CVE matches, so entries are conservative
 *      + carry a `verifiedNote`; uncertain modules are omitted (they stay an honest coverage gap).
 *   2. NAME → **version** — NOT here. Versions are NCS-release-specific (west.yml pins them) and are NEVER
 *      fabricated. They are supplied at scan time by an injected `ModuleVersionResolver` (the operator's NCS
 *      manifest / a per-release table). No version ⇒ no synthesized PURL ⇒ the component stays a gap.
 *
 * `applyCuratedPurls` fills `purl` only when BOTH a coordinate and a version are available, marking
 * `purlSource: "curated"` so the coverage caption can stay honest about tool-emitted vs map-derived identifiers.
 */
import { classifyComponent, type NormalizedSbom, type SbomComponent } from "./sbomNormalize"

export interface PurlCoordinate {
	/** Canonical PURL coordinate WITHOUT a version, e.g. "pkg:github/Mbed-TLS/mbedtls". */
	coordinate: string
	/** How it was confirmed — a real ncs-sbom purl ("self-validated") or the canonical upstream repo. */
	verifiedNote: string
}

/**
 * Module name (───deps stripped, lowercased, `_`→`-`) → canonical coordinate. The three "self-validated" entries
 * were emitted verbatim by a real NCS SBOM (design/16, 2026-06-25); the rest are canonical upstream repos OSV
 * indexes. Conservative on purpose — add an entry only when the coordinate is unambiguous, with a verifiedNote.
 */
export const COMPONENT_PURL_MAP: Record<string, PurlCoordinate> = {
	mbedtls: { coordinate: "pkg:github/Mbed-TLS/mbedtls", verifiedNote: "self-validated: emitted by real ncs-sbom (2026-06-25)" },
	"trusted-firmware-m": {
		coordinate: "pkg:generic/trusted-firmware-m",
		verifiedNote: "self-validated: emitted by real ncs-sbom (generic/vcs; OSV coverage weak)",
	},
	hostap: { coordinate: "pkg:generic/hostap", verifiedNote: "self-validated: emitted by real ncs-sbom (generic/vcs)" },
	mcuboot: { coordinate: "pkg:github/mcu-tools/mcuboot", verifiedNote: "canonical upstream repo (mcu-tools/mcuboot)" },
	openthread: { coordinate: "pkg:github/openthread/openthread", verifiedNote: "canonical upstream repo" },
	cjson: { coordinate: "pkg:github/DaveGamble/cJSON", verifiedNote: "canonical upstream repo" },
	lz4: { coordinate: "pkg:github/lz4/lz4", verifiedNote: "canonical upstream repo" },
	lvgl: { coordinate: "pkg:github/lvgl/lvgl", verifiedNote: "canonical upstream repo" },
	nanopb: { coordinate: "pkg:github/nanopb/nanopb", verifiedNote: "canonical upstream repo" },
	littlefs: { coordinate: "pkg:github/littlefs-project/littlefs", verifiedNote: "canonical upstream repo" },
	zcbor: { coordinate: "pkg:github/NordicSemiconductor/zcbor", verifiedNote: "canonical upstream repo (Nordic)" },
}

/** Canonicalize an SBOM component name to a map key: strip a trailing "-deps"/"-sources", lowercase, `_`→`-`.
 *  ("-sources" is how `west spdx` names the Zephyr core in zephyr.spdx — `zephyr-sources`.) */
export function normalizeModuleName(name: string): string {
	return name
		.replace(/-(deps|sources)$/i, "")
		.trim()
		.toLowerCase()
		.replace(/_/g, "-")
}

/**
 * Curated NAME → **CPE vendor:product prefix** (no version). The companion to COMPONENT_PURL_MAP for the
 * platform cores that `west spdx`/`esp-idf-sbom` DON'T tag — most importantly **Zephyr itself** (the biggest,
 * most CVE-bearing component, emitted with NO CPE/PURL and only a git SHA). With a curated CPE + an SDK-resolved
 * **semver** (NOT the SHA — useless for matching), the existing CPE→NVD path detects the core's CVEs. The CPE
 * vendor/product strings are the ones NVD indexes (verified: NVD returns Zephyr CVEs for `cpe:2.3:o:zephyrproject:
 * zephyr:<ver>`). Trust-critical facts (they feed "found CVE-X") → curated + auditable here; the *judgment* about
 * them lives in the bits (the kbit↔host separation rule).
 */
export interface CpeCoordinate {
	/** CPE 2.3 vendor:product prefix WITHOUT a version, e.g. "cpe:2.3:o:zephyrproject:zephyr". */
	prefix: string
	verifiedNote: string
}

export const COMPONENT_CPE_MAP: Record<string, CpeCoordinate> = {
	zephyr: {
		prefix: "cpe:2.3:o:zephyrproject:zephyr",
		verifiedNote: "NVD-confirmed (2026-06-28: NVD returns Zephyr CVEs for this CPE @4.2.99); west spdx omits it",
	},
	mcuboot: {
		prefix: "cpe:2.3:a:mcuboot:mcuboot",
		verifiedNote: "canonical NVD vendor/product for MCUboot; complements its PURL coordinate",
	},
	"esp-idf": {
		prefix: "cpe:2.3:a:espressif:esp-idf",
		verifiedNote: "NVD-confirmed (2026-06-28: cpe:2.3:a:espressif:esp-idf exists, 173 entries); the ESP core",
	},
}

/** A version is usable for a CPE only if it's a semver-ish string, NOT a git SHA (SHAs don't version-match). */
function isCpeVersion(v: string | undefined): v is string {
	return !!v && /^v?\d+(\.\d+)+/.test(v) && !/^[0-9a-f]{12,}$/i.test(v)
}

/** Form a curated CPE only when BOTH a vendor/product prefix and a SEMVER (not a SHA) exist. */
export function curatedCpeFor(name: string, version: string | undefined): string | undefined {
	if (!isCpeVersion(version)) {
		return undefined
	}
	const c = COMPONENT_CPE_MAP[normalizeModuleName(name)]
	return c ? `${c.prefix}:${version.replace(/^v/, "")}:*:*:*:*:*:*:*` : undefined
}

/**
 * Fill missing CPEs from the curated CPE map (mirrors applyCuratedPurls). For each component WITHOUT a
 * tool-emitted CPE: take its own version, else the resolver's — and only if BOTH a mapped vendor/product and a
 * SEMVER exist, set `cpe` (marked `cpeSource: "curated"`). Re-derives coverage so a now-CPE-bearing core counts
 * as queryable (via the CPE→NVD path). `resolveVersion` here MUST yield a semver (e.g. zephyr/VERSION), not the
 * SHA west records — that's the whole point.
 */
export function applyCuratedCpes(sbom: NormalizedSbom, resolveVersion?: ModuleVersionResolver): NormalizedSbom {
	const components: SbomComponent[] = sbom.components.map((c) => {
		if (c.cpe) {
			return c
		}
		const version = isCpeVersion(c.version) ? c.version : resolveVersion?.(normalizeModuleName(c.name))
		const cpe = curatedCpeFor(c.name, version)
		if (!cpe) {
			return c
		}
		const filled: SbomComponent = { ...c, cpe, cpeSource: "curated" }
		const verdict = classifyComponent(filled)
		filled.queryable = verdict.queryable
		filled.dropReason = verdict.dropReason
		return filled
	})

	const byDropReason: NormalizedSbom["coverage"]["byDropReason"] = {}
	let queryable = 0
	for (const c of components) {
		if (c.queryable) {
			queryable++
		} else if (c.dropReason) {
			byDropReason[c.dropReason] = (byDropReason[c.dropReason] ?? 0) + 1
		}
	}
	return {
		components,
		coverage: {
			total: components.length,
			withPurl: components.filter((c) => !!c.purl).length,
			withCpe: components.filter((c) => !!c.cpe).length,
			unidentified: components.filter((c) => !c.purl && !c.cpe).length,
			queryable,
			byDropReason,
		},
	}
}

/** A version source the operator wires from west.yml / an NCS-release table. Returns undefined when unknown. */
export type ModuleVersionResolver = (moduleName: string) => string | undefined

/** Form a curated PURL only when BOTH a coordinate and a version exist. Never fabricates a version. */
export function curatedPurlFor(name: string, version: string | undefined): string | undefined {
	if (!version) {
		return undefined
	}
	const c = COMPONENT_PURL_MAP[normalizeModuleName(name)]
	return c ? `${c.coordinate}@${version}` : undefined
}

/**
 * Fill missing PURLs from the curated map, in place over a copy, and return a re-derived NormalizedSbom. For each
 * component WITHOUT a tool-emitted PURL: take its own version, else the resolver's — and only if BOTH a version
 * and a mapped coordinate exist, set `purl` (marked `purlSource: "curated"`). Coverage is recomputed so the
 * queryable count + drop-reason breakdown reflect the newly-queryable components honestly.
 */
export function applyCuratedPurls(sbom: NormalizedSbom, resolveVersion?: ModuleVersionResolver): NormalizedSbom {
	const components: SbomComponent[] = sbom.components.map((c) => {
		if (c.purl) {
			return { ...c, purlSource: c.purlSource ?? "tool" }
		}
		// The resolver keys on the CANONICAL module name (e.g. "mcuboot"), matching the operator's west.yml table.
		const version = c.version || resolveVersion?.(normalizeModuleName(c.name))
		const purl = curatedPurlFor(c.name, version)
		if (!purl) {
			return c
		}
		const filled: SbomComponent = { ...c, purl, version: version ?? c.version, purlSource: "curated" }
		const verdict = classifyComponent(filled)
		filled.queryable = verdict.queryable
		filled.dropReason = verdict.dropReason
		return filled
	})

	const byDropReason: NormalizedSbom["coverage"]["byDropReason"] = {}
	let queryable = 0
	for (const c of components) {
		if (c.queryable) {
			queryable++
		} else if (c.dropReason) {
			byDropReason[c.dropReason] = (byDropReason[c.dropReason] ?? 0) + 1
		}
	}
	return {
		components,
		coverage: {
			total: components.length,
			withPurl: components.filter((c) => !!c.purl).length,
			withCpe: components.filter((c) => !!c.cpe).length,
			unidentified: components.filter((c) => !c.purl && !c.cpe).length,
			queryable,
			byDropReason,
		},
	}
}

/** How many components carry a curated-map-derived PURL (provenance honesty for the coverage caption). */
export function curatedCount(sbom: NormalizedSbom): number {
	return sbom.components.filter((c) => c.purlSource === "curated").length
}
