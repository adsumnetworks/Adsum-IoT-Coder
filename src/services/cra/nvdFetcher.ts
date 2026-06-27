/**
 * Production NVD fetcher (CPE → NVD path, F11). The host-side network call behind the injected `NvdFetcher`
 * interface — the model never makes it (the host owns the CVE lookup; the model triggers + presents). HTTP is
 * injected so query-build stays pure + fixture-testable; the default uses global `fetch`.
 *
 * NVD rate-limits: 5 requests / rolling 30 s without a key, 50 with one. We read `NVDAPIKEY` from the env and
 * send it as the `apiKey` header when present (mirrors esp-idf-sbom's behaviour). A non-2xx / transport error
 * THROWS so the caller surfaces "scan unavailable" rather than a false-clean.
 */
import type { NvdFetcher } from "./nvdMatch"

export const NVD_CVE_API = "https://services.nvd.nist.gov/rest/json/cves/2.0"
export const nvdCveUrl = (cpeName: string) => `${NVD_CVE_API}?cpeName=${encodeURIComponent(cpeName)}`

/** Injected transport: GET a URL with optional headers, return the response text. Throws on non-2xx / transport error. */
export type HttpGet = (url: string, headers?: Record<string, string>) => Promise<string>

/** Per-request deadline: a hung NVD socket must NOT hang the whole scan (no progress indicator → an open
 *  connection looks "stuck" forever). On timeout we THROW → the caller surfaces "scan unavailable". */
const HTTP_TIMEOUT_MS = 25_000

const defaultHttpGet: HttpGet = async (url, headers) => {
	let res: Response
	try {
		res = await fetch(url, { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
	} catch (e) {
		if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
			throw new Error(
				`NVD query timed out after ${HTTP_TIMEOUT_MS / 1000}s (network slow, unreachable, or rate-limited) — scan unavailable, not a clean result`,
			)
		}
		throw new Error(`NVD query failed: ${e instanceof Error ? e.message : String(e)}`)
	}
	if (!res.ok) {
		throw new Error(`NVD query failed: HTTP ${res.status} ${res.statusText}`)
	}
	return await res.text()
}

/** Build an `NvdFetcher` that GETs NVD's CVE API by CPE name. Sends `NVDAPIKEY` (if set) for higher rate limits. */
export function makeNvdFetcher(httpGet: HttpGet = defaultHttpGet): NvdFetcher {
	const key = process.env.NVDAPIKEY
	return (cpeName: string) => httpGet(nvdCveUrl(cpeName), key ? { apiKey: key } : undefined)
}
