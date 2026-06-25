/**
 * REAL-NETWORK smoke test for the OSV fetcher — hits api.osv.dev. SKIPPED by default so CI / `test:cve` never
 * depend on the network. Run it yourself when online:
 *
 *   RUN_OSV_NETWORK=1 npm run test:cve:network
 *
 * It is intentionally NOT imported by all.node-test.ts. It proves: (1) the live querybatch endpoint returns the
 * shape `parseOsvBatch` expects, and (2) the end-to-end host scan surfaces a real, known advisory honestly.
 * Uses a deliberately old, widely-known-vulnerable package (lodash 4.17.0) as a stable positive control.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { runCveScanHost } from "./cveScanHost"
import { makeOsvFetcher } from "./osvFetcher"

const NETWORK = process.env.RUN_OSV_NETWORK === "1"
const todayIso = new Date().toISOString().slice(0, 10)

// A minimal SPDX carrying a PURL OSV definitely knows has advisories — a positive control for the live path.
const KNOWN_VULNERABLE_SBOM = `SPDXVersion: SPDX-2.3

PackageName: lodash
PackageVersion: 4.17.0
ExternalRef: PACKAGE-MANAGER purl pkg:npm/lodash@4.17.0
`

test("LIVE OSV: a known-vulnerable package returns advisories end-to-end", { skip: !NETWORK }, async () => {
	const r = await runCveScanHost(
		{ sbomText: KNOWN_VULNERABLE_SBOM },
		{ fetcher: makeOsvFetcher(), readers: { readText: () => undefined, nm: () => undefined }, asOf: todayIso },
	)
	assert.ok(r.findings.length > 0, "OSV should report at least one advisory for lodash@4.17.0")
	assert.match(r.findings[0].match.vulnIds.join(","), /(CVE|GHSA)-/, "advisory ids should look like CVE/GHSA")
	assert.match(r.report, /lodash@4\.17\.0/)
	console.log(`[live OSV] lodash@4.17.0 → ${r.findings.flatMap((f) => f.match.vulnIds).join(", ")}`)
})
