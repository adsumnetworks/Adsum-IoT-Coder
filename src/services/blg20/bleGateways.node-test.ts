/**
 * The Bluetooth scan's bookkeeping: what one `list --ble --json` answer does to what is known.
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/blg20/bleGateways.node-test.ts
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import type { Blg20BleRow } from "@shared/blg20"
import { commissionFrom, foldScan } from "./bleGateways"

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

// As tool 0.4.0 printed `prov status --json` on the bench, 11 Oct 2026 (unit AD50).
const AD50_PROV = {
	ok: true,
	commissioned: true,
	line: "commissioned · 53.24508, -1.44321 ±14 m · sends over LTE-M · MQTT without TLS to broker.emqx.io",
	window: "open, closes 3:52 after you disconnect",
	health: { verdict: { state: "warn", words: "Still checking: a first send can take a few minutes; read the status again." } },
}

test("the commissioning facts come from the tool's answer, the unit's verdict with them", () => {
	assert.deepEqual(commissionFrom(AD50_PROV), {
		commissioned: true,
		line: AD50_PROV.line,
		verdict: { state: "warn", words: AD50_PROV.health.verdict.words },
		window: AD50_PROV.window,
	})
	assert.equal(commissionFrom({ ok: true, passport: {} }), undefined, "a tool without them: no facts, no guess")
	assert.equal(commissionFrom(null), undefined)
	const fresh = commissionFrom({
		commissioned: false,
		line: "not commissioned",
		window: null,
		health: { verdict: { state: "nope" } },
	})
	assert.deepEqual(
		fresh,
		{ commissioned: false, line: "not commissioned", window: null },
		"an unknown verdict is dropped, never coloured",
	)
})
