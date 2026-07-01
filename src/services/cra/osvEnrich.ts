/**
 * OSV enrichment (CVE scan loop — design/15 §4/§11 fast-follow). The OSV querybatch returns vuln IDs only; this
 * fetches each vuln's full record (`GET /v1/vulns/{id}`) to surface **severity (CVSS vector verbatim)** and the
 * **fixed version(s)** — the inputs §9 ranking needs.
 *
 * Honesty: we **surface, never compute** (design §4: "osv-scanner already computes a base score — read it; don't
 * recompute"). We emit OSV's CVSS *vector strings* verbatim + any fixed-version events, all attributed to OSV +
 * dated by the caller. Unscored is a first-class state. The HTTP GET is injected (pure parse, fixture-tested);
 * a per-id failure degrades to "unenriched" (never a fabricated score). No model content (D11-R).
 */

export interface OsvSeverity {
	/** OSV severity type, e.g. "CVSS_V3" / "CVSS_V4". */
	type: string
	/** The score field verbatim — for CVSS types this is the vector string (we do NOT parse/compute a number). */
	score: string
}

export interface EnrichedVuln {
	id: string
	/** CVSS vectors as OSV reports them (may be empty → unscored). */
	severities: OsvSeverity[]
	/** Fixed version(s) from OSV `affected[].ranges[].events[].fixed` (deduped; may be empty). */
	fixedVersions: string[]
}

/** Injected per-id GET. The real impl GETs https://api.osv.dev/v1/vulns/{id}. Throws on transport/non-2xx. */
export type OsvVulnFetcher = (id: string) => Promise<string>

/** Parse one OSV vuln record → severities (verbatim) + fixed versions. Tolerant: malformed → empty enrichment. */
export function parseOsvVuln(id: string, json: string): EnrichedVuln {
	let doc: unknown
	try {
		doc = JSON.parse(json)
	} catch {
		return { id, severities: [], fixedVersions: [] }
	}
	const rec = (doc ?? {}) as Record<string, unknown>

	const severities: OsvSeverity[] = []
	const sevRaw = Array.isArray(rec.severity) ? (rec.severity as Array<Record<string, unknown>>) : []
	for (const s of sevRaw) {
		const type = typeof s?.type === "string" ? s.type : ""
		const score = typeof s?.score === "string" ? s.score : ""
		if (type && score) {
			severities.push({ type, score })
		}
	}

	const fixed = new Set<string>()
	const affected = Array.isArray(rec.affected) ? (rec.affected as Array<Record<string, unknown>>) : []
	for (const a of affected) {
		const ranges = Array.isArray(a?.ranges) ? (a.ranges as Array<Record<string, unknown>>) : []
		for (const r of ranges) {
			const events = Array.isArray(r?.events) ? (r.events as Array<Record<string, unknown>>) : []
			for (const e of events) {
				if (typeof e?.fixed === "string" && e.fixed) {
					fixed.add(e.fixed)
				}
			}
		}
	}

	return { id, severities, fixedVersions: [...fixed] }
}

/**
 * Enrich a set of vuln IDs. IDs are deduped; each is fetched independently and a per-id failure is recorded as an
 * empty (unenriched) entry — the scan never fails wholesale because one advisory record couldn't be fetched.
 */
export async function enrichVulns(ids: string[], fetcher: OsvVulnFetcher): Promise<Map<string, EnrichedVuln>> {
	const out = new Map<string, EnrichedVuln>()
	for (const id of [...new Set(ids)]) {
		try {
			out.set(id, parseOsvVuln(id, await fetcher(id)))
		} catch {
			out.set(id, { id, severities: [], fixedVersions: [] }) // honest "unenriched", never a fabricated score
		}
	}
	return out
}
