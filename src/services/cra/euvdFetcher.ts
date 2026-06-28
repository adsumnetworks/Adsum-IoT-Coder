/**
 * EUVD fetcher — the EU Vulnerability Database (ENISA) as a real scan source, not just framing.
 *
 * The CRA names the EUVD as its reference database, so a CRA scan should actually consult it. EUVD carries no
 * CPE/version ranges, so NVD (CPE) + OSV (PURL) stay the version-precise *matchers*; EUVD is the EU-authoritative
 * **confirmation + enrichment** layer: for a CVE we already found, it adds the EUVD id, CVSS, EPSS
 * (exploit-probability) and a KEV/"exploited" flag + EU advisory links. All sourced facts — never a verdict.
 *
 * API: https://euvdservices.enisa.europa.eu/api/search (no auth). A CUSTOM User-Agent is MANDATORY — the gateway
 * 403s the default fetch/UA. HTTP is injected so URL-build + parsing stay pure + fixture-testable.
 */

export const EUVD_SEARCH_URL = "https://euvdservices.enisa.europa.eu/api/search"
/** Default UA — the EUVD gateway blocks the stock fetch UA with 403. */
export const EUVD_USER_AGENT = "AdsumIoTCoder-CRA/0.1 (+https://adsumnetworks.com)"

/** Enrich-by-CVE: find the EUVD record whose aliases include this CVE id. */
export const euvdSearchByCveUrl = (cveId: string) => `${EUVD_SEARCH_URL}?text=${encodeURIComponent(cveId)}&size=10`
/** Discover-by-product: list EUVD records for a vendor/product (e.g. zephyrproject / zephyr). */
export const euvdSearchByProductUrl = (vendor: string, product: string, fromScore = 0) =>
	`${EUVD_SEARCH_URL}?vendor=${encodeURIComponent(vendor)}&product=${encodeURIComponent(product)}&fromScore=${fromScore}&size=50`

/** Injected transport: GET a URL with headers, return the response text. Throws on non-2xx / transport error. */
export type HttpGet = (url: string, headers?: Record<string, string>) => Promise<string>

const HTTP_TIMEOUT_MS = 25_000

const defaultHttpGet: HttpGet = async (url, headers) => {
	let res: Response
	try {
		res = await fetch(url, { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
	} catch (e) {
		if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
			throw new Error(`EUVD query timed out after ${HTTP_TIMEOUT_MS / 1000}s — enrichment skipped, not a clean result`)
		}
		throw new Error(`EUVD query failed: ${e instanceof Error ? e.message : String(e)}`)
	}
	if (!res.ok) {
		throw new Error(`EUVD query failed: HTTP ${res.status} ${res.statusText}`)
	}
	return await res.text()
}

/** What we surface from an EUVD record — all sourced facts, never a verdict. */
export interface EuvdRecord {
	/** The EUVD identifier, e.g. "EUVD-2026-35353". */
	euvdId: string
	/** The matched CVE id (from the record's aliases). */
	cveId: string
	/** CVSS base score (0–10), if present. */
	baseScore?: number
	/** EPSS exploit-probability (0–1), if present. */
	epss?: number
	/** True when EUVD marks it actively exploited (KEV). */
	exploited: boolean
	/** Reference URLs (EU advisories, GHSA, patches). */
	references: string[]
}

const splitLines = (s: unknown): string[] =>
	typeof s === "string"
		? s
				.split(/[\r\n]+/)
				.map((x) => x.trim())
				.filter(Boolean)
		: []

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/**
 * Pure parser: given the raw EUVD `/search` JSON text and the CVE id we searched for, return the matching record
 * (the item whose `aliases` contains that CVE id). Returns null on no match / malformed JSON — never throws.
 */
export function parseEuvdSearch(jsonText: string, cveId: string): EuvdRecord | null {
	let data: any
	try {
		data = JSON.parse(jsonText)
	} catch {
		return null
	}
	const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
	const want = cveId.toUpperCase()
	const hit = items.find((it) => splitLines(it?.aliases).some((a) => a.toUpperCase() === want))
	if (!hit) {
		return null
	}
	return {
		euvdId: typeof hit.id === "string" ? hit.id : "",
		cveId,
		baseScore: num(hit.baseScore),
		epss: num(hit.epss),
		exploited: Boolean(hit.exploitedSince) || hit.exploited === true,
		references: splitLines(hit.references),
	}
}

/** A function that returns the raw EUVD search JSON for a CVE id. Throws on transport error (caller degrades). */
export type EuvdFetcher = (cveId: string) => Promise<string>

/** Build an `EuvdFetcher` that GETs EUVD's search API by CVE id, sending the mandatory custom User-Agent. */
export function makeEuvdFetcher(httpGet: HttpGet = defaultHttpGet): EuvdFetcher {
	return (cveId: string) => httpGet(euvdSearchByCveUrl(cveId), { "User-Agent": EUVD_USER_AGENT })
}

/**
 * Enrich a set of CVE ids with their EUVD records. Per-id failures degrade to "unenriched" (omitted from the map)
 * — a flaky EUVD lookup must NEVER fail the whole scan or be read as "clean". Ids are de-duped.
 */
export async function enrichWithEuvd(cveIds: string[], fetcher: EuvdFetcher): Promise<Map<string, EuvdRecord>> {
	const out = new Map<string, EuvdRecord>()
	const unique = [...new Set(cveIds.map((id) => id.trim()).filter(Boolean))]
	for (const id of unique) {
		try {
			const rec = parseEuvdSearch(await fetcher(id), id)
			if (rec) {
				out.set(id, rec)
			}
		} catch {
			// degrade: leave this id unenriched
		}
	}
	return out
}
