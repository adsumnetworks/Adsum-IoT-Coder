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

/**
 * Why a component is not OSV-queryable (§5 per-component coverage record). Canonical across the scan loop —
 * `osvMatch` reuses it. The first three are detectable from the SBOM alone; `fork-unresolved` / `subcomponent`
 * are curated-map reasons reserved for when the component→PURL map lands (declared for forward-compat, NOT
 * emitted yet — we never claim a reason we can't substantiate).
 */
export type DropReason = "no-version" | "no-id" | "cpe-only" | "fork-unresolved" | "subcomponent"

export interface SbomComponent {
	name: string
	version: string
	/** Package URL (`pkg:…`) — the primary OSV match key. */
	purl?: string
	/** CPE 2.2 / 2.3 id — the secondary key (used when PURL is absent, common on ESP). */
	cpe?: string
	/**
	 * Populated by `normalizeSbom`: true iff we produced an OSV-usable identifier (a PURL). Optional on
	 * hand-built literals; `classifyComponent` derives it identically when absent, so there is one source of
	 * truth and no drift between the stored fact and what the OSV planner queries.
	 */
	queryable?: boolean
	/** null iff queryable; otherwise the honest reason it was dropped from the OSV query. Same provenance. */
	dropReason?: DropReason | null
	/** Provenance of `purl`: "tool" = emitted by the SBOM tool; "curated" = filled by the curated map. */
	purlSource?: "tool" | "curated"
	/** Provenance of `cpe`: "tool" = emitted by the SBOM tool; "curated" = filled by the curated CPE map (cores). */
	cpeSource?: "tool" | "curated"
}

export interface SbomCoverage {
	total: number
	withPurl: number
	withCpe: number
	/** Components with NEITHER a PURL nor a CPE — not queryable; surfaced honestly ("Z had no identifier"). */
	unidentified: number
	/** Count with an OSV-usable identifier (= withPurl today; > withPurl once a CPE→PURL map lands). */
	queryable: number
	/** Reason breakdown for the non-queryable set — what the §8.1a caption renders + the §8.4 parity test reads. */
	byDropReason: Partial<Record<DropReason, number>>
}

export interface NormalizedSbom {
	components: SbomComponent[]
	coverage: SbomCoverage
}

/**
 * Single source of truth for OSV-queryability (§5). OSV keys on PURL, so a PURL ⇒ queryable; otherwise the
 * honest reason: a CPE but no PURL → "cpe-only" (has an id, just not OSV-usable today — the ESP case); no id
 * at all but a version → "no-id"; not even a version → "no-version". `normalizeSbom` calls this for every
 * component AND `planOsvScan` calls it at query time, so the stored fact and the actual query can never diverge.
 */
export function classifyComponent(c: SbomComponent): { queryable: boolean; dropReason: DropReason | null } {
	if (c.purl) {
		return { queryable: true, dropReason: null }
	}
	if (c.cpe) {
		return { queryable: false, dropReason: "cpe-only" }
	}
	if (!c.version) {
		return { queryable: false, dropReason: "no-version" }
	}
	return { queryable: false, dropReason: "no-id" }
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
	const byDropReason: Partial<Record<DropReason, number>> = {}
	let queryable = 0
	for (const c of components) {
		const verdict = classifyComponent(c)
		// Store the per-component coverage fact on the component (§5) — the single object downstream reads.
		c.queryable = verdict.queryable
		c.dropReason = verdict.dropReason
		if (verdict.queryable) {
			queryable++
		} else if (verdict.dropReason) {
			byDropReason[verdict.dropReason] = (byDropReason[verdict.dropReason] ?? 0) + 1
		}
	}
	const coverage: SbomCoverage = {
		total: components.length,
		withPurl: components.filter((c) => !!c.purl).length,
		withCpe: components.filter((c) => !!c.cpe).length,
		unidentified: components.filter((c) => !c.purl && !c.cpe).length,
		queryable,
		byDropReason,
	}
	return { components, coverage }
}

/** The OSV-queryable subset (has an OSV-usable identifier = a PURL). The rest are the honest coverage gap. */
export function queryableComponents(sbom: NormalizedSbom): SbomComponent[] {
	return sbom.components.filter((c) => classifyComponent(c).queryable)
}
