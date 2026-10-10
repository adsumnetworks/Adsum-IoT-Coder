/**
 * The Bluetooth scan's bookkeeping: what one `list --ble --json` answer does to what is known.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/blg20/bleGateways.node-test.ts
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import type { Blg20BleRow } from "@shared/blg20"
import { foldScan } from "./bleGateways"

// As the tool printed it on the bench, 10 Oct 2026.
const AD50: Blg20BleRow = {
	address: "D3:58:8E:7A:AD:50",
	name: "Adsum LBG20x D3588E7AAD50",
	family: "LBG20",
	short: "AD50",
	id: "D3588E7AAD50",
	rssi: -64,
	bonded: true,
	window: true,
}

test("a unit in range is listed with its window open", () => {
	const known = new Map<string, Blg20BleRow>()
	const { rows, error } = foldScan(known, { ok: true, door: "ble", units: [AD50] })
	assert.equal(error, undefined)
	assert.deepEqual(
		rows.map((r) => [r.short, r.window]),
		[["AD50", true]],
	)
})

test("a unit seen before and gone now stays, marked with its window closed and no signal", () => {
	const known = new Map<string, Blg20BleRow>()
	foldScan(known, { ok: true, units: [AD50] })
	const { rows } = foldScan(known, { ok: true, units: [] })
	assert.deepEqual(
		rows.map((r) => [r.short, r.window, r.rssi]),
		[["AD50", false, null]],
	)
	const back = foldScan(known, { ok: true, units: [AD50] }).rows
	assert.equal(back[0].window, true, "it advertises again: the window is open again")
})

test("a failed scan keeps what was known and says why", () => {
	const known = new Map<string, Blg20BleRow>()
	foldScan(known, { ok: true, units: [AD50] })
	const { rows, error } = foldScan(known, { ok: false, error: "Bluetooth scan failed (Bluetooth is off)" })
	assert.equal(rows.length, 1)
	assert.match(error ?? "", /Bluetooth is off/)
	assert.match(foldScan(known, null).error ?? "", /no answer/)
})
