/**
 * P2 fix-commit AUTO-discovery (design/30). OSV vulnerability records carry the upstream fix COMMIT in a GIT range
 * (`affected[].ranges[type=GIT].events[].fixed`), so for any OSV-covered CVE we can resolve the fix SHA WITHOUT
 * curation — then the P2 git check confirms whether it's in the dev's tree. Curated `advisoryHints.fixCommitSha`
 * stays the verified override + the fallback for advisories OSV doesn't carry (e.g. Zephyr's repo-level GHSAs).
 *
 * API-RESILIENCE (a standing rule): every outbound call assumes the service may not answer. This resolver carries
 * a timeout and CATCHES everything — a timeout / 5xx / 404 / network-down / unparseable body all degrade to
 * `undefined`. It NEVER throws, never blocks the scan, and "couldn't reach OSV" is treated as "not auto-resolved →
 * hedge", NEVER as evidence the CVE is unpatched (no false claim in either direction).
 */

const OSV_VULN_URL = (id: string) => `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`
const HTTP_TIMEOUT_MS = 15_000

/** Resolve a CVE id → its upstream fix-commit SHA (or undefined when unknown/unreachable). */
export type FixCommitResolver = (cveId: string) => Promise<string | undefined>

/** Injected transport (so the resolver is unit-testable with no network). Returns status + body; never throws. */
export type FixCommitHttpGet = (url: string) => Promise<{ ok: boolean; status: number; text: string }>

const defaultGet: FixCommitHttpGet = async (url) => {
	const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
	return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : "" }
}

/** Pure: pull the first upstream fix-commit SHA from an OSV record's GIT ranges. Tolerant of any/missing shape. */
export function parseOsvFixCommit(recordJson: string): string | undefined {
	let doc: unknown
	try {
		doc = JSON.parse(recordJson)
	} catch {
		return undefined
	}
	const affected = (doc as { affected?: unknown })?.affected
	if (!Array.isArray(affected)) {
		return undefined
	}
	for (const a of affected) {
		const ranges = (a as { ranges?: unknown })?.ranges
		if (!Array.isArray(ranges)) {
			continue
		}
		for (const r of ranges) {
			if ((r as { type?: string })?.type !== "GIT") {
				continue
			}
			const events = (r as { events?: unknown })?.events
			if (!Array.isArray(events)) {
				continue
			}
			for (const e of events) {
				const fixed = (e as { fixed?: unknown })?.fixed
				if (typeof fixed === "string" && /^[0-9a-f]{7,40}$/i.test(fixed)) {
					return fixed
				}
			}
		}
	}
	return undefined
}

/**
 * Build an OSV-backed fix-commit resolver. `GET /v1/vulns/<cve>` → parse the GIT-range fixed commit. Resilient:
 * any failure (timeout / non-2xx / network / parse) → `undefined` (hedge), never a throw. CVEs OSV doesn't carry
 * (404 — e.g. Zephyr repo-GHSAs) also → `undefined` → they stay curated/hedged.
 */
export function makeOsvFixCommitResolver(httpGet: FixCommitHttpGet = defaultGet): FixCommitResolver {
	return async (cveId) => {
		try {
			const res = await httpGet(OSV_VULN_URL(cveId))
			if (!res.ok) {
				return undefined
			}
			return parseOsvFixCommit(res.text)
		} catch {
			return undefined
		}
	}
}
