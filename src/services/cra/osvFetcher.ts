/**
 * Production OSV fetcher (CVE scan loop — design/15 §3/§4). The host-side network call behind the injected
 * `OsvFetcher` interface — the model never makes it (D11-R: the host owns the CVE lookup, the model only
 * triggers + presents). HTTP is injected (`HttpPost`) so the query-build/merge stays pure + fixture-testable;
 * the default impl uses global `fetch`.
 *
 * Risk mitigations:
 *  - **Silent truncation** (design §13: "no silent caps"): OSV's querybatch caps at 1000 queries; a large SBOM
 *    is CHUNKED into ≤1000-query requests and the `results` arrays are concatenated IN ORDER, so the index
 *    alignment `parseOsvBatch` relies on is preserved across chunks — no component is dropped unannounced.
 *  - **Network failure masquerading as "no vulns"**: a non-2xx response or transport error THROWS (the caller
 *    surfaces "scan unavailable" honestly); it must never be swallowed into an empty-but-clean result.
 */
import type { OsvVulnFetcher } from "./osvEnrich"
import type { OsvFetcher, OsvQueryBatch } from "./osvMatch"

export const OSV_QUERYBATCH_URL = "https://api.osv.dev/v1/querybatch"
export const osvVulnUrl = (id: string) => `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`
/** OSV's documented per-request query cap. */
export const OSV_BATCH_LIMIT = 1000

/** Injected transport: POST a JSON body to a URL, return the response text. Throws on a non-2xx / transport error. */
export type HttpPost = (url: string, body: string) => Promise<string>
/** Injected transport: GET a URL, return the response text. Throws on a non-2xx / transport error. */
export type HttpGet = (url: string) => Promise<string>

const defaultHttpPost: HttpPost = async (url, body) => {
	const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })
	if (!res.ok) {
		throw new Error(`OSV query failed: HTTP ${res.status} ${res.statusText}`)
	}
	return await res.text()
}

const defaultHttpGet: HttpGet = async (url) => {
	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`OSV vuln fetch failed: HTTP ${res.status} ${res.statusText}`)
	}
	return await res.text()
}

/** Build an `OsvVulnFetcher` that GETs a single vuln record by id (for severity/range enrichment). */
export function makeOsvVulnFetcher(httpGet: HttpGet = defaultHttpGet): OsvVulnFetcher {
	return (id: string) => httpGet(osvVulnUrl(id))
}

/** Split into ≤limit-sized chunks (preserves order). */
function chunk<T>(items: T[], limit: number): T[][] {
	const out: T[][] = []
	for (let i = 0; i < items.length; i += limit) {
		out.push(items.slice(i, i + limit))
	}
	return out
}

/**
 * Build an `OsvFetcher` that POSTs to OSV's querybatch endpoint, chunking large batches and merging the
 * per-query `results` in order. The merged response is shaped like a single querybatch response
 * (`{ results: [...] }`) so `parseOsvBatch` can map it back to the input queries by index.
 */
export function makeOsvFetcher(httpPost: HttpPost = defaultHttpPost): OsvFetcher {
	return async (batch: OsvQueryBatch): Promise<string> => {
		if (batch.queries.length <= OSV_BATCH_LIMIT) {
			return httpPost(OSV_QUERYBATCH_URL, JSON.stringify(batch))
		}
		const merged: unknown[] = []
		for (const part of chunk(batch.queries, OSV_BATCH_LIMIT)) {
			const text = await httpPost(OSV_QUERYBATCH_URL, JSON.stringify({ queries: part }))
			const doc = JSON.parse(text) as { results?: unknown[] }
			// A chunk that returns no `results` array still must contribute one slot per query to keep alignment.
			const results = Array.isArray(doc?.results) ? doc.results : part.map(() => ({}))
			merged.push(...results)
		}
		return JSON.stringify({ results: merged })
	}
}
