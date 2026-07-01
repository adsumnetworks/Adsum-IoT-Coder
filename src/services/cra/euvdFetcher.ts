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
 * EPSS is defined as a probability in [0, 1]; the renderer turns it into a percentage (`× 100`). A live EUVD
 * response returned values like `2.88` / `3.40` for some records (rendered as a nonsensical "288% / 340%"
 * exploit-likelihood) — the API's EPSS scale is not consistent across records. We will NOT fabricate a
 * confidence number we can't trust: accept EPSS only when it's a valid 0–1 probability; anything else
 * (>1, <0, NaN, non-number) → undefined → the field is simply omitted (honest absence over a bogus percent). */
const epssProb = (v: unknown): number | undefined => {
	const n = num(v)
	return n != null && n >= 0 && n <= 1 ? n : undefined
}

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
		epss: epssProb(hit.epss),
		exploited: Boolean(hit.exploitedSince) || hit.exploited === true,
		references: splitLines(hit.references),
	}
}

/**
 * Pure parser: the EUVD `/search` JSON → one EuvdRecord per item that carries a CVE alias (the CVE id is the
 * first `CVE-…` alias). Used by discover-by-product. Returns [] on malformed JSON — never throws.
 */
export function parseEuvdList(jsonText: string): EuvdRecord[] {
	let data: any
	try {
		data = JSON.parse(jsonText)
	} catch {
		return []
	}
	const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
	const out: EuvdRecord[] = []
	for (const it of items) {
		const cveId = splitLines(it?.aliases).find((a) => /^CVE-\d{4}-\d+$/i.test(a))
		if (!cveId) {
			continue
		}
		out.push({
			euvdId: typeof it.id === "string" ? it.id : "",
			cveId: cveId.toUpperCase(),
			baseScore: num(it.baseScore),
			epss: epssProb(it.epss),
			exploited: Boolean(it.exploitedSince) || it.exploited === true,
			references: splitLines(it.references),
		})
	}
	return out
}

/**
 * Discover-by-product: list the EUVD CVEs for a vendor/product (e.g. zephyrproject/zephyr) — the EU-authoritative
 * source that catches CVEs NVD's CPE configs miss (verified: EUVD has CVE-2025-10456, NVD-by-CPE didn't). EUVD
 * carries no version ranges, so the CALLER must version-filter (e.g. the git fix-in-tree check); this returns the
 * raw candidate list. Paginates up to `maxPages`. A page failure stops pagination (returns what we have) — never
 * throws / never a false "clean". The mandatory custom User-Agent is sent.
 */
/**
 * EUVD discover-by-product policy knobs (design/25 T6 — named + documented, not magic numbers). Governing bit:
 * `cra/workflows/cve-scan.md` ("which databases"). Both are reviewable there; the host just executes them.
 *  - MIN_SCORE: only surface CVSS ≥ 7 (high/critical) product advisories — the discover-by-product list is a
 *    broad net (a product can have hundreds), so we cap it to the severities worth the dev's verify-effort.
 *  - MAX_PAGES: 4 × 100 = 400 advisories — more than any real product carries as of 2026; a runaway-page guard.
 */
export const EUVD_DISCOVER_MIN_SCORE = 7
export const EUVD_DISCOVER_MAX_PAGES = 4

export async function discoverByProduct(
	vendor: string,
	product: string,
	httpGet: HttpGet = defaultHttpGet,
	opts?: { fromScore?: number; maxPages?: number },
): Promise<EuvdRecord[]> {
	const maxPages = opts?.maxPages ?? EUVD_DISCOVER_MAX_PAGES
	const fromScore = opts?.fromScore ?? 0
	const seen = new Map<string, EuvdRecord>()
	for (let page = 0; page < maxPages; page++) {
		const url =
			`${EUVD_SEARCH_URL}?vendor=${encodeURIComponent(vendor)}&product=${encodeURIComponent(product)}` +
			`&fromScore=${fromScore}&page=${page}&size=100`
		let recs: EuvdRecord[]
		try {
			recs = parseEuvdList(await httpGet(url, { "User-Agent": EUVD_USER_AGENT }))
		} catch {
			break // a flaky page stops pagination; we keep what we have (never a false clean)
		}
		if (recs.length === 0) {
			break
		}
		for (const r of recs) {
			if (!seen.has(r.cveId)) {
				seen.set(r.cveId, r)
			}
		}
		if (recs.length < 100) {
			break // last page
		}
	}
	return [...seen.values()]
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
