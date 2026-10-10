import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, describe, test } from "node:test"
import { FirmwareClient, type FirmwareEntry } from "./FirmwareClient"
import {
	defaultFolder,
	downloadFirmware,
	flashLine,
	LICENCE_FILE,
	licenceText,
	listLocalFirmware,
	RECEIPT_FILE,
	readLocal,
	receiptStatusNow,
	setReceiptStatus,
	sha256,
} from "./FirmwareStore"

/**
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/firmware/FirmwareStore.test.ts
 */
const HEX = Buffer.from(":020000040000FA\n:00000001FF\n")
const BIN = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])
const entry: FirmwareEntry = {
	id: "adsum/firmware/blg20x-production",
	version: "2.3.0",
	family: "blg20x",
	variant: null,
	rung: "production",
	group: "blg20-prod-hex",
	title: "BLG20x production",
	summary: null,
	min_ext: null,
	security: false,
	released_at: "2026-10-01T00:00:00.000Z",
	licence: { id: "LicenseRef-Adsum-Proprietary", text: null, termMonths: 12 },
	signature: null,
	signed_by: null,
	entitled: true,
	artifacts: [
		{ path: "nrf9151/zephyr.signed.hex", sha256: sha256(HEX), size: HEX.length, group: null },
		{ path: "bm20/zephyr.signed.bin", sha256: sha256(BIN), size: BIN.length, group: null },
	],
}

/** A licence file the bundle ships itself, as the published demo bundles do. */
const BUNDLE_LICENCE = Buffer.from("Adsum Template Licence, demo terms: the bundle's own words.\n")
const BYTES: Record<string, Buffer> = { [sha256(HEX)]: HEX, [sha256(BIN)]: BIN, [sha256(BUNDLE_LICENCE)]: BUNDLE_LICENCE }

/** A fetch that plays the registry: authorise, then the files under the token. */
function fakeFetch(opts: { tamper?: boolean; firmware?: FirmwareEntry } = {}): typeof fetch {
	return (async (url: string, init?: RequestInit) => {
		const u = String(url)
		if (u.endsWith("/v1/firmware/authorise")) {
			assert.equal(init?.method, "POST")
			return new Response(
				JSON.stringify({
					token: "adf_test",
					expires_in: 900,
					expires_at: "",
					licensee: "ops@acme.example",
					firmware: opts.firmware ?? entry,
				}),
				{ status: 200 },
			)
		}
		if (u.includes("/v1/firmware/artifact/")) {
			// The token is a header, never part of the URL (a URL is logged).
			assert.doesNotMatch(u, /adf_test/)
			assert.equal((init?.headers as Record<string, string>)["X-Adsum-Firmware-Token"], "adf_test")
			const sha = u.split("/artifact/")[1].split("?")[0]
			const bytes = BYTES[sha] ?? BIN
			return new Response(opts.tamper ? Buffer.concat([bytes, Buffer.from("x")]) : bytes, { status: 200 })
		}
		return new Response("not found", { status: 404 })
	}) as typeof fetch
}

let root = ""
before(() => {
	root = mkdtempSync(path.join(tmpdir(), "adsum-fw-"))
})
after(() => rmSync(root, { recursive: true, force: true }))

describe("the firmware lane on disk", () => {
	test("the default folder is firmware/<family>/<version>/ under the workspace", () => {
		assert.equal(defaultFolder("/ws", entry), path.join("/ws", "firmware", "blg20x", "2.3.0"))
	})

	test("a download lands whole, with its licence and receipt beside the files", async () => {
		const client = new FirmwareClient("https://registry.test", fakeFetch())
		const folder = defaultFolder(root, entry)
		const local = await downloadFirmware(client, entry.id, entry.version, folder)
		assert.equal(local.folder, folder)
		assert.equal(local.intact, true)
		assert.equal(readFileSync(path.join(folder, "nrf9151/zephyr.signed.hex")).toString(), HEX.toString())
		const receipt = JSON.parse(readFileSync(path.join(folder, RECEIPT_FILE), "utf8"))
		assert.equal(receipt.licensee, "ops@acme.example")
		assert.equal(receipt.status, "active")
		// The term runs from the download, not from the release date.
		assert.equal(receipt.term_start, receipt.downloaded_at)
		assert.notEqual(receipt.term_start.slice(0, 10), String(entry.released_at).slice(0, 10))
		const start = new Date(receipt.term_start)
		const end = new Date(receipt.term_end)
		assert.equal(end.getFullYear(), start.getFullYear() + 1, "a twelve-month term")
		// The two files, and the licence written beside them, recorded as it is on disk.
		assert.equal(receipt.artifacts.length, 3)
		assert.ok(receipt.artifacts.some((a: { path: string }) => a.path === LICENCE_FILE))
		const licence = readFileSync(path.join(folder, LICENCE_FILE), "utf8")
		assert.match(licence, /Licensed to: ops@acme.example/)
		assert.match(licence, /Watermark: [0-9a-f]{16}/)
		assert.match(licence, /may not be redistributed/)
		// The scan finds it, and the flash line names what, for whom, from where.
		const found = listLocalFirmware([root])
		assert.equal(found.length, 1)
		assert.equal(
			flashLine(found[0], "nrf9151/zephyr.signed.hex"),
			`Flashing BLG20x production v2.3.0, licensed to ops@acme.example, from ${path.join(folder, "nrf9151/zephyr.signed.hex")}`,
		)
	})

	test("a tampered byte leaves nothing behind", async () => {
		const client = new FirmwareClient("https://registry.test", fakeFetch({ tamper: true }))
		const folder = path.join(root, "firmware", "blg20x", "9.9.9")
		await assert.rejects(() => downloadFirmware(client, entry.id, "9.9.9", folder), /do not match their hash/)
		assert.equal(readLocal(folder), null)
		assert.equal(
			listLocalFirmware([root]).some((l) => l.receipt.version === "9.9.9"),
			false,
		)
	})

	test("an altered file on disk is not intact; a revoked group marks the receipt, never deletes", () => {
		const folder = defaultFolder(root, entry)
		writeFileSync(path.join(folder, "bm20/zephyr.signed.bin"), Buffer.from("changed"))
		assert.equal(readLocal(folder)?.intact, false)
		setReceiptStatus(folder, "expired")
		const r = readLocal(folder)
		assert.equal(r?.receipt.status, "expired")
		assert.ok(r?.receipt.status_checked_at)
		assert.equal(readFileSync(path.join(folder, "nrf9151/zephyr.signed.hex")).toString(), HEX.toString(), "the files stay")
	})

	test("an ended term reads expired even while the group is held; a live term with the group reads active", () => {
		const live = { term_end: "2027-10-11T00:00:00.000Z" }
		const ended = { term_end: "2026-10-01T00:00:00.000Z" }
		const now = new Date("2026-10-11T00:00:00.000Z")
		assert.equal(receiptStatusNow(live, true, now), "active")
		assert.equal(receiptStatusNow(ended, true, now), "expired")
		assert.equal(receiptStatusNow(live, false, now), "expired", "a group no longer held")
		assert.equal(receiptStatusNow({ term_end: "" }, true, now), "active", "no term recorded: the account decides")
	})

	test("a folder without a receipt is not firmware; a receipt without files is not intact", () => {
		const stray = path.join(root, "firmware", "stray", "1.0.0")
		mkdirSync(stray, { recursive: true })
		writeFileSync(path.join(stray, "x.hex"), HEX)
		assert.equal(readLocal(stray), null)
		writeFileSync(
			path.join(stray, RECEIPT_FILE),
			JSON.stringify({ ...entryReceipt(), artifacts: [{ path: "missing.hex", sha256: "00", size: 1 }] }),
		)
		assert.equal(readLocal(stray)?.intact, false)
	})

	test("the licence text carries the registry's own words when it has them", () => {
		const t = licenceText(
			{ ...entry, licence: { id: "ATL-1", text: "The real licence.", termMonths: 12 } },
			"acme",
			"2026-01-01",
			"2027-01-01",
			"abcd",
		)
		assert.match(t, /The real licence\./)
		assert.match(t, /Licence: ATL-1/)
		assert.doesNotMatch(t, /summary/)
	})

	test("a bundle that ships its own licence: one licence file, the licensee above the bundle's words, and the folder reads intact", async () => {
		const withLicence: FirmwareEntry = {
			...entry,
			id: "adsum/firmware/blg20x-demo-hex",
			version: "1.0.0",
			rung: "demo-hex",
			group: "blg20-demo-hex",
			title: "BLG20x demo pair",
			artifacts: [
				{ path: LICENCE_FILE, sha256: sha256(BUNDLE_LICENCE), size: BUNDLE_LICENCE.length, group: null },
				...entry.artifacts,
			],
		}
		const client = new FirmwareClient("https://registry.test", fakeFetch({ firmware: withLicence }))
		const folder = path.join(root, "firmware", "blg20x", "1.0.0")
		const local = await downloadFirmware(client, withLicence.id, withLicence.version, folder)
		assert.equal(local.intact, true)
		const licence = readFileSync(path.join(folder, LICENCE_FILE), "utf8")
		assert.match(licence, /^BLG20x demo pair · adsum\/firmware\/blg20x-demo-hex 1\.0\.0\nLicensed to: ops@acme\.example\n/)
		assert.match(licence, /Watermark: [0-9a-f]{16}\n/)
		assert.match(licence, /the bundle's own words/)
		assert.doesNotMatch(licence, /summary; ask Adsum Networks/, "the bundle's words replace the summary")
		assert.equal(readLocal(folder)?.intact, true, "a fresh folder must never read as altered")
		const receipt = JSON.parse(readFileSync(path.join(folder, RECEIPT_FILE), "utf8"))
		const licenceRows = receipt.artifacts.filter((a: { path: string }) => a.path === LICENCE_FILE)
		assert.equal(licenceRows.length, 1)
		assert.equal(licenceRows[0].sha256, sha256(Buffer.from(licence)))
		assert.equal(receipt.artifacts.length, 3)
	})
})

function entryReceipt() {
	return {
		id: "x",
		version: "1.0.0",
		family: "stray",
		variant: null,
		rung: null,
		group: null,
		title: "Stray",
		licensee: "a",
		licence_id: "b",
		term_start: "",
		term_end: "",
		watermark_id: "",
		downloaded_at: "",
		status: "active",
	}
}
