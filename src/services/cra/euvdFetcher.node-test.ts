/**
 * Tests for the EUVD fetcher (the EU Vulnerability Database as a real scan source). node:test via test:cve.
 * Pure parser + transport behaviour; no real network (HTTP is injected). Fixture mirrors the real
 * euvdservices.enisa.europa.eu/api/search shape captured 2026-06-28.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import {
	discoverByProduct,
	type EuvdFetcher,
	enrichWithEuvd,
	euvdSearchByCveUrl,
	type HttpGet,
	makeEuvdFetcher,
	parseEuvdList,
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

// --- discover-by-product (the EU-authoritative source that catches what NVD's CPE misses) ---

const ZEPHYR_PAGE = JSON.stringify({
	total: 2,
	items: [
		{ id: "EUVD-2025-30238", aliases: "CVE-2025-10456", baseScore: 7.1, epss: 0.2 },
		{ id: "EUVD-2026-35353", aliases: "CVE-2026-5068\nGHSA-qrcq-hxwj-mqxm", baseScore: 7.6, epss: 0.17 },
		{ id: "EUVD-x", aliases: "GSD-only-no-cve" }, // no CVE alias → skipped
	],
})

test("parseEuvdList: one record per item with a CVE alias; non-CVE items skipped", () => {
	const recs = parseEuvdList(ZEPHYR_PAGE)
	assert.equal(recs.length, 2)
	assert.deepEqual(recs.map((r) => r.cveId).sort(), ["CVE-2025-10456", "CVE-2026-5068"])
	assert.equal(parseEuvdList("{bad json").length, 0) // never throws
})

test("discoverByProduct: lists a product's EUVD CVEs (incl. CVE-2025-10456 that NVD-CPE missed), de-duped", async () => {
	let lastUrl = ""
	const httpGet: HttpGet = async (url, headers) => {
		lastUrl = url
		assert.match(headers?.["User-Agent"] ?? "", /AdsumIoTCoder/) // custom UA sent
		return ZEPHYR_PAGE // <100 items → pagination stops after page 0
	}
	const recs = await discoverByProduct("zephyrproject", "zephyr", httpGet, { fromScore: 7 })
	assert.match(lastUrl, /vendor=zephyrproject&product=zephyr&fromScore=7/)
	assert.ok(
		recs.some((r) => r.cveId === "CVE-2025-10456"),
		"discover-by-product must surface the EUVD-only CVE NVD's CPE missed",
	)
})

test("discoverByProduct: a page failure degrades to what we have (never throws / never a false clean)", async () => {
	const httpGet: HttpGet = async () => {
		throw new Error("EUVD 503")
	}
	assert.deepEqual(await discoverByProduct("zephyrproject", "zephyr", httpGet), [])
})

test("P2a (2906c): EPSS > 1 is rejected (not rendered as a >100% bogus percent), valid 0–1 kept", () => {
	// A live EUVD response returned epss like 2.88 / 3.40 for some records — the renderer (× 100) turned those
	// into "288% / 340%". EPSS is a 0–1 probability; an out-of-range value is dropped (honest absence), a valid one kept.
	const bogus = JSON.stringify({ items: [{ id: "EUVD-2020-2536", epss: 3.4, baseScore: 9, aliases: "CVE-2020-10071" }] })
	const ok = JSON.stringify({ items: [{ id: "EUVD-2025-7660", epss: 0.72, baseScore: 7, aliases: "CVE-2025-24912" }] })
	assert.equal(parseEuvdSearch(bogus, "CVE-2020-10071")?.epss, undefined)
	assert.equal(parseEuvdSearch(ok, "CVE-2025-24912")?.epss, 0.72)
	// discover-by-product path (parseEuvdList) clamps identically.
	assert.equal(parseEuvdList(bogus)[0].epss, undefined)
	assert.equal(parseEuvdList(ok)[0].epss, 0.72)
})

test("P2a: EPSS exactly 0 and 1 are valid; negative is rejected", () => {
	const edge = JSON.stringify({
		items: [
			{ id: "E0", epss: 0, aliases: "CVE-2000-0001" },
			{ id: "E1", epss: 1, aliases: "CVE-2000-0002" },
			{ id: "E2", epss: -0.1, aliases: "CVE-2000-0003" },
		],
	})
	const list = parseEuvdList(edge)
	assert.equal(list.find((r) => r.cveId === "CVE-2000-0001")?.epss, 0)
	assert.equal(list.find((r) => r.cveId === "CVE-2000-0002")?.epss, 1)
	assert.equal(list.find((r) => r.cveId === "CVE-2000-0003")?.epss, undefined)
})
