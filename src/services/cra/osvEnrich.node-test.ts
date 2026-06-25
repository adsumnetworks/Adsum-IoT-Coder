/**
 * Tests for OSV enrichment. The per-id GET is injected — no network. Honesty invariant: surface verbatim, never
 * compute a score; a fetch failure degrades to "unenriched", never a fabricated severity.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { enrichVulns, type OsvVulnFetcher, parseOsvVuln } from "./osvEnrich"

const MBED_RECORD = JSON.stringify({
	id: "CVE-2024-23170",
	severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:L/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N" }],
	affected: [{ ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "3.5.1" }] }] }],
})

test("parseOsvVuln: surfaces CVSS vector verbatim + the fixed version (never computes a number)", () => {
	const e = parseOsvVuln("CVE-2024-23170", MBED_RECORD)
	assert.equal(e.severities.length, 1)
	assert.equal(e.severities[0].type, "CVSS_V3")
	assert.match(e.severities[0].score, /^CVSS:3\.1\//) // the vector string, verbatim
	assert.deepEqual(e.fixedVersions, ["3.5.1"])
})

test("parseOsvVuln: no severity → unscored (empty), not a fabricated score", () => {
	const e = parseOsvVuln("CVE-X", JSON.stringify({ id: "CVE-X", affected: [] }))
	assert.deepEqual(e.severities, [])
	assert.deepEqual(e.fixedVersions, [])
})

test("parseOsvVuln: multiple fixed events across ranges are deduped", () => {
	const rec = JSON.stringify({
		id: "CVE-Y",
		affected: [
			{ ranges: [{ events: [{ fixed: "1.2.0" }] }] },
			{ ranges: [{ events: [{ fixed: "1.2.0" }, { fixed: "2.0.0" }] }] },
		],
	})
	assert.deepEqual(parseOsvVuln("CVE-Y", rec).fixedVersions, ["1.2.0", "2.0.0"])
})

test("parseOsvVuln: malformed JSON → empty enrichment, never a throw", () => {
	assert.deepEqual(parseOsvVuln("CVE-Z", "{not json"), { id: "CVE-Z", severities: [], fixedVersions: [] })
})

test("enrichVulns: dedupes ids and maps each to its record", async () => {
	const calls: string[] = []
	const fetcher: OsvVulnFetcher = async (id) => {
		calls.push(id)
		return id === "CVE-2024-23170" ? MBED_RECORD : JSON.stringify({ id })
	}
	const map = await enrichVulns(["CVE-2024-23170", "CVE-2024-23170", "GHSA-x"], fetcher)
	assert.deepEqual(calls, ["CVE-2024-23170", "GHSA-x"]) // deduped
	assert.equal(map.get("CVE-2024-23170")?.fixedVersions[0], "3.5.1")
	assert.deepEqual(map.get("GHSA-x")?.severities, [])
})

test("enrichVulns: a per-id fetch failure degrades to unenriched (scan never fails wholesale)", async () => {
	const fetcher: OsvVulnFetcher = async (id) => {
		if (id === "CVE-bad") {
			throw new Error("HTTP 500")
		}
		return MBED_RECORD
	}
	const map = await enrichVulns(["CVE-2024-23170", "CVE-bad"], fetcher)
	assert.equal(map.get("CVE-2024-23170")?.fixedVersions[0], "3.5.1")
	assert.deepEqual(map.get("CVE-bad"), { id: "CVE-bad", severities: [], fixedVersions: [] }) // honest, not fabricated
})
