/**
 * SBOM → component-identifier normalizer (CVE scan loop — design/15 §3/§5).
 *
 * Parses an SPDX SBOM (tag-value *or* JSON) into a flat component list carrying the identifiers a vulnerability
 * database matches on — **PURL** (primary, OSV's key) and **CPE** (secondary; ESP SBOMs often carry these when
 * PURL is sparse) — plus an honest **coverage** report.
 *
 * Parity lives HERE, not in the vendor SBOM tools: both nRF (`west ncs-sbom`) and ESP (`esp-idf-sbom`) SPDX flow
 * through this one normalizer, so they query OSV identically and we report the gap honestly per platform.
 *
 * Pure + deterministic + fixture-testable. NO network, NO external tools, NO model content — the OSV query and
 * the evidence-mode presentation are separate, injectable steps. (D11-R: host observes/correlates; the model
 * never fabricates a CVE.)
 */

export interface SbomComponent {
	name: string
	version: string
	/** Package URL (`pkg:…`) — the primary OSV match key. */
	purl?: string
	/** CPE 2.2 / 2.3 id — the secondary key (used when PURL is absent, common on ESP). */
	cpe?: string
}

export interface SbomCoverage {
	total: number
	withPurl: number
	withCpe: number
	/** Components with NEITHER a PURL nor a CPE — not queryable; surfaced honestly ("Z had no identifier"). */
	unidentified: number
}

export interface NormalizedSbom {
	components: SbomComponent[]
	coverage: SbomCoverage
}

/** SPDX externalRef referenceType values we care about (case-insensitive). */
const PURL_TYPE_RE = /^purl$/i
const CPE_TYPE_RE = /^cpe(22|23)type$/i

const looksLikeJson = (text: string): boolean => {
	const t = text.trimStart()
	return t.startsWith("{") || t.startsWith("[")
}

/** SPDX JSON (`.spdx.json`): `{ packages: [{ name, versionInfo, externalRefs:[{referenceType,referenceLocator}] }] }`. */
function parseSpdxJson(text: string): SbomComponent[] {
	let doc: unknown
	try {
		doc = JSON.parse(text)
	} catch {
		return []
	}
	const packages = (doc as { packages?: unknown })?.packages
	if (!Array.isArray(packages)) {
		return []
	}
	const out: SbomComponent[] = []
	for (const p of packages as Array<Record<string, unknown>>) {
		const name = typeof p?.name === "string" ? p.name : ""
		if (!name) {
			continue
		}
		const version = typeof p?.versionInfo === "string" ? p.versionInfo : ""
		const comp: SbomComponent = { name, version }
		const refs = Array.isArray(p?.externalRefs) ? (p.externalRefs as Array<Record<string, unknown>>) : []
		for (const r of refs) {
			const type = String(r?.referenceType ?? "")
			const loc = typeof r?.referenceLocator === "string" ? r.referenceLocator : undefined
			if (!loc) {
				continue
			}
			if (PURL_TYPE_RE.test(type) && !comp.purl) {
				comp.purl = loc
			} else if (CPE_TYPE_RE.test(type) && !comp.cpe) {
				comp.cpe = loc
			}
		}
		out.push(comp)
	}
	return out
}

/** SPDX tag-value (`.spdx`): `PackageName:` blocks with `PackageVersion:` + `ExternalRef: <cat> <type> <locator>`. */
function parseSpdxTagValue(text: string): SbomComponent[] {
	const out: SbomComponent[] = []
	let cur: SbomComponent | null = null
	const flush = () => {
		if (cur?.name) {
			out.push(cur)
		}
	}
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim()
		const nameM = line.match(/^PackageName:\s*(.+)$/)
		if (nameM) {
			flush()
			cur = { name: nameM[1].trim(), version: "" }
			continue
		}
		if (!cur) {
			continue
		}
		const verM = line.match(/^PackageVersion:\s*(.+)$/)
		if (verM) {
			cur.version = verM[1].trim()
			continue
		}
		const refM = line.match(/^ExternalRef:\s*\S+\s+(\S+)\s+(.+)$/)
		if (refM) {
			const type = refM[1]
			const loc = refM[2].trim()
			if (PURL_TYPE_RE.test(type) && !cur.purl) {
				cur.purl = loc
			} else if (CPE_TYPE_RE.test(type) && !cur.cpe) {
				cur.cpe = loc
			}
		}
	}
	flush()
	return out
}

/** Normalize raw SPDX text (either serialization) → components + coverage. */
export function normalizeSbom(spdxText: string): NormalizedSbom {
	const components = looksLikeJson(spdxText) ? parseSpdxJson(spdxText) : parseSpdxTagValue(spdxText)
	const coverage: SbomCoverage = {
		total: components.length,
		withPurl: components.filter((c) => !!c.purl).length,
		withCpe: components.filter((c) => !!c.cpe).length,
		unidentified: components.filter((c) => !c.purl && !c.cpe).length,
	}
	return { components, coverage }
}

/** The OSV-queryable subset (has a PURL or CPE). The rest are reported as the honest coverage gap. */
export function queryableComponents(sbom: NormalizedSbom): SbomComponent[] {
	return sbom.components.filter((c) => !!c.purl || !!c.cpe)
}
