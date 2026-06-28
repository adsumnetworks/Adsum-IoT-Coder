/**
 * Tests for the EUVD fetcher (the EU Vulnerability Database as a real scan source). node:test via test:cve.
 * Pure parser + transport behaviour; no real network (HTTP is injected). Fixture mirrors the real
 * euvdservices.enisa.europa.eu/api/search shape captured 2026-06-28.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import {
	type EuvdFetcher,
	enrichWithEuvd,
	euvdSearchByCveUrl,
	type HttpGet,
	makeEuvdFetcher,
	parseEuvdSearch,
} from "./euvdFetcher"

// Real-shaped EUVD /search response (CVE-2026-5068 → EUVD-2026-35353), trimmed to the fields we read.
const EUVD_HIT = JSON.stringify({
	total: 1,
	items: [
		{
			id: "EUVD-2026-35353",
			description: "A remote, unauthenticated BLE peer can trigger a 2-byte out-of-bounds write in the Bluetooth host…",
			baseScore: 7.6,
			baseScoreVersion: "3.1",
			epss: 0.17,
			aliases: "CVE-2026-5068\n",
			references:
				"https://github.com/zephyrproject-rtos/zephyr/security/advisories/GHSA-qrcq-hxwj-mqxm\nhttps://euvd.enisa.europa.eu",
			enisaIdProduct: [{ name: "zephyr" }],
			enisaIdVendor: [{ name: "zephyrproject" }],
		},
	],
})

test("parseEuvdSearch: extracts EUVD id, score, EPSS, references and matches by CVE alias", () => {
	const rec = parseEuvdSearch(EUVD_HIT, "CVE-2026-5068")
	assert.ok(rec)
	assert.equal(rec.euvdId, "EUVD-2026-35353")
	assert.equal(rec.cveId, "CVE-2026-5068")
	assert.equal(rec.baseScore, 7.6)
	assert.equal(rec.epss, 0.17)
	assert.equal(rec.exploited, false) // no exploitedSince → not KEV
	assert.equal(rec.references.length, 2)
	assert.ok(rec.references[0].includes("GHSA-qrcq-hxwj-mqxm"))
})

test("parseEuvdSearch: case-insensitive alias match", () => {
	assert.ok(parseEuvdSearch(EUVD_HIT, "cve-2026-5068"))
})

test("parseEuvdSearch: no matching alias → null (does not return an unrelated item)", () => {
	assert.equal(parseEuvdSearch(EUVD_HIT, "CVE-2099-0001"), null)
})

test("parseEuvdSearch: malformed JSON → null, never throws", () => {
	assert.equal(parseEuvdSearch("{not json", "CVE-2026-5068"), null)
	assert.equal(parseEuvdSearch("", "CVE-2026-5068"), null)
})

test("parseEuvdSearch: exploitedSince → exploited=true (KEV)", () => {
	const kev = JSON.stringify({ items: [{ id: "EUVD-X", aliases: "CVE-2024-0001", exploitedSince: "2025-01-01" }] })
	assert.equal(parseEuvdSearch(kev, "CVE-2024-0001")?.exploited, true)
})

test("makeEuvdFetcher: sends the mandatory custom User-Agent (gateway 403s the default)", async () => {
	let sentHeaders: Record<string, string> | undefined
	const httpGet: HttpGet = async (url, headers) => {
		sentHeaders = headers
		assert.ok(url.startsWith(euvdSearchByCveUrl("CVE-2026-5068").split("?")[0]))
		return EUVD_HIT
	}
	const fetcher = makeEuvdFetcher(httpGet)
	await fetcher("CVE-2026-5068")
	assert.ok(sentHeaders?.["User-Agent"], "expected a custom User-Agent header")
	assert.match(sentHeaders!["User-Agent"], /AdsumIoTCoder/)
})

test("enrichWithEuvd: maps ids → records, de-dupes, and a per-id failure degrades (never throws / never 'clean')", async () => {
	const fetcher: EuvdFetcher = async (id) => {
		if (id === "CVE-FAIL") {
			throw new Error("EUVD 503")
		}
		return EUVD_HIT.replace("CVE-2026-5068", id) // pretend each id resolves to its own record
	}
	const map = await enrichWithEuvd(["CVE-2026-5068", "CVE-2026-5068", "CVE-FAIL"], fetcher)
	assert.equal(map.size, 1) // dup collapsed; the failing id degraded out
	assert.ok(map.has("CVE-2026-5068"))
	assert.equal(map.has("CVE-FAIL"), false)
})
