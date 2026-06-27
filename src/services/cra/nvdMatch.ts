/**
 * NVD (NIST National Vulnerability Database) CVE matching by CPE — the **CPE → NVD** path (F11).
 *
 * Why this exists: the embedded C libraries in an NCS/Zephyr build (mbed TLS, MCUboot, …) are NOT indexed by
 * OSV under `pkg:github/...` PURLs — proven empirically (OSV returns 0). Their CVEs live in NVD, keyed by
 * **CPE 2.3**. e.g. `cpe:2.3:a:arm:mbed_tls:2.16.0:*` → 38 CVEs from NVD, vs 0 from OSV. So this is the primary
 * matcher for embedded components; osvMatch (PURL→OSV/GHSA) stays as the secondary that catches NVD gaps
 * (e.g. MCUboot in GitHub Advisory).
 *
 * The ONLY network touch is the injected `NvdFetcher`; query selection + response parsing are pure +
 * fixture-testable. A non-2xx / transport error in the fetcher THROWS (the caller surfaces "scan unavailable"
 * honestly) — it must never be swallowed into a false-clean result.
 */
import type { SbomComponent } from "./sbomNormalize"

/** Injected transport: GET NVD CVEs for one CPE name, return the response JSON text. Throws on non-2xx/transport error. */
export type NvdFetcher = (cpeName: string) => Promise<string>

export interface NvdVuln {
	id: string
	/** CVSS base severity (CRITICAL/HIGH/MEDIUM/LOW) when NVD provides a metric; undefined otherwise. */
	severity?: string
}
export interface NvdMatch {
	component: SbomComponent
	vulns: NvdVuln[]
}
export interface NvdSkipped {
	component: SbomComponent
	reason: "no-cpe"
}
export interface NvdScanResult {
	matches: NvdMatch[]
	skipped: NvdSkipped[]
	queriedCount: number
}

// Minimal shape of the NVD /cves/2.0 response we read (kept narrow — NVD returns much more).
interface NvdMetric {
	cvssData?: { baseSeverity?: string }
	baseSeverity?: string
}
interface NvdResponse {
	vulnerabilities?: Array<{
		cve?: {
			id?: string
			metrics?: { cvssMetricV31?: NvdMetric[]; cvssMetricV30?: NvdMetric[]; cvssMetricV2?: NvdMetric[] }
		}
	}>
}

/** Parse one NVD `/cves/2.0` response into `{id, severity}` entries. Tolerant of missing metrics / bad JSON. */
export function parseNvdResponse(responseJson: string): NvdVuln[] {
	let doc: NvdResponse
	try {
		doc = JSON.parse(responseJson) as NvdResponse
	} catch {
		return []
	}
	const out: NvdVuln[] = []
	for (const v of doc?.vulnerabilities ?? []) {
		const cve = v?.cve
		if (!cve?.id) {
			continue
		}
		const m = cve.metrics ?? {}
		// CVSS v3.1 → v3.0 → v2 (v2 carries baseSeverity on the metric, not cvssData).
		const sev =
			m.cvssMetricV31?.[0]?.cvssData?.baseSeverity ??
			m.cvssMetricV30?.[0]?.cvssData?.baseSeverity ??
			m.cvssMetricV2?.[0]?.baseSeverity
		out.push({ id: cve.id, severity: typeof sev === "string" ? sev : undefined })
	}
	return out
}

/**
 * Scan components against NVD by CPE — one request per CPE-bearing component (NVD has no batch endpoint).
 * Components without a CPE are skipped honestly (their PURL path is osvMatch's job — never silently dropped).
 * Throws if the fetcher does (network failure ≠ "no vulns").
 */
export async function scanWithNvd(components: SbomComponent[], fetcher: NvdFetcher): Promise<NvdScanResult> {
	const matches: NvdMatch[] = []
	const skipped: NvdSkipped[] = []
	let queriedCount = 0
	for (const c of components) {
		if (!c.cpe) {
			skipped.push({ component: c, reason: "no-cpe" })
			continue
		}
		queriedCount++
		const vulns = parseNvdResponse(await fetcher(c.cpe))
		if (vulns.length > 0) {
			matches.push({ component: c, vulns })
		}
	}
	return { matches, skipped, queriedCount }
}
