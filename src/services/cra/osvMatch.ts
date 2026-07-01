/**
 * OSV matching (CVE scan loop — design/15 §3/§4). Builds an OSV querybatch from normalized SBOM components
 * and parses the response into matches. The ONLY network touch is an **injected fetcher** — the query-build
 * and response-parse are pure + fixture-testable, and the host (not the model) owns the call (D11-R).
 *
 * OSV keys on **PURL**. CPE-only and unidentified components are recorded as honest **coverage gaps**
 * (never silently dropped) — a future NVD/EUVD path handles CPE (red-team: ESP is CPE-heavy). The batch
 * endpoint returns vuln **IDs only**; range/severity enrichment is a separate follow-up step (documented).
 */
import { classifyComponent, type DropReason, type SbomComponent } from "./sbomNormalize"

export interface OsvQuery {
	package: { purl: string }
}
export interface OsvQueryBatch {
	queries: OsvQuery[]
}

/** A component left out of the OSV query, with the honest reason (feeds the coverage line). */
export interface SkippedComponent {
	component: SbomComponent
	reason: DropReason
}

export interface OsvPlan {
	queries: OsvQuery[]
	/** queries[i] ↔ queried[i] — index alignment used to map the response back to components. */
	queried: SbomComponent[]
	skipped: SkippedComponent[]
}

/**
 * Build the OSV querybatch. Queryability is decided by the SAME `classifyComponent` the normalizer uses, so the
 * query set and the stored per-component coverage fact can't drift. OSV keys on PURL; CPE-only + unidentified
 * are skipped honestly (never silently dropped), carrying the canonical drop reason.
 */
export function planOsvScan(components: SbomComponent[]): OsvPlan {
	const queries: OsvQuery[] = []
	const queried: SbomComponent[] = []
	const skipped: SkippedComponent[] = []
	for (const c of components) {
		const { queryable, dropReason } = classifyComponent(c)
		if (queryable && c.purl) {
			queries.push({ package: { purl: c.purl } })
			queried.push(c)
		} else {
			skipped.push({ component: c, reason: dropReason ?? "no-id" })
		}
	}
	return { queries, queried, skipped }
}

export interface OsvMatch {
	component: SbomComponent
	/** OSV/CVE/GHSA ids reported for this component@version (batch returns ids only). */
	vulnIds: string[]
}

/** Parse an OSV querybatch response (`{ results: [{ vulns?: [{id}] }] }`, index-aligned to the queries). */
export function parseOsvBatch(responseJson: string, queried: SbomComponent[]): OsvMatch[] {
	let doc: unknown
	try {
		doc = JSON.parse(responseJson)
	} catch {
		return []
	}
	const results = (doc as { results?: unknown })?.results
	if (!Array.isArray(results)) {
		return []
	}
	const matches: OsvMatch[] = []
	results.forEach((r, i) => {
		const comp = queried[i]
		if (!comp) {
			return
		}
		const vulnsRaw = (r as { vulns?: unknown })?.vulns
		const vulns = Array.isArray(vulnsRaw) ? (vulnsRaw as Array<Record<string, unknown>>) : []
		const ids = vulns.map((v) => String(v?.id ?? "")).filter(Boolean)
		if (ids.length > 0) {
			matches.push({ component: comp, vulnIds: ids })
		}
	})
	return matches
}

export interface OsvScanResult {
	matches: OsvMatch[]
	skipped: SkippedComponent[]
	queriedCount: number
	/** "ok" = the batch query ran; "unavailable" = the fetcher failed → the OSV lane is INCOMPLETE (partial scan,
	 *  never a clean result). Graceful degradation (design/28): OSV failing doesn't kill the NVD/EUVD lanes. */
	status: "ok" | "unavailable"
}

/** The injected network call — the real impl POSTs to https://api.osv.dev/v1/querybatch (host-side). */
export type OsvFetcher = (batch: OsvQueryBatch) => Promise<string>

/** Plan → fetch (injected) → parse. The fetcher is the only network touch; everything else is deterministic. */
export async function scanWithOsv(components: SbomComponent[], fetcher: OsvFetcher): Promise<OsvScanResult> {
	const plan = planOsvScan(components)
	if (plan.queries.length === 0) {
		return { matches: [], skipped: plan.skipped, queriedCount: 0, status: "ok" }
	}
	try {
		const responseJson = await fetcher({ queries: plan.queries })
		return {
			matches: parseOsvBatch(responseJson, plan.queried),
			skipped: plan.skipped,
			queriedCount: plan.queried.length,
			status: "ok",
		}
	} catch {
		// OSV unreachable — keep the coverage gaps we know, flag the lane unavailable (honest partial, not clean).
		return { matches: [], skipped: plan.skipped, queriedCount: plan.queried.length, status: "unavailable" }
	}
}
