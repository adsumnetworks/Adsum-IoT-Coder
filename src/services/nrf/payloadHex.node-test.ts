// Regression coverage for the "sniffer payload truncated to 16 bytes" bug: a founder decoding Minew BLE
// tags found every payload cut to 16 bytes + a bare "…", even though legacy advertising payloads run to
// 31 bytes and extended advertising runs to 255. Two independent truncation points existed — one in the
// HCI/btmon decode path (hciParser.ts's payloadToHex) and one in the over-the-air sniffer decode path
// (nordicBleParser.ts's hexCapped) — both raised to MAX_PAYLOAD_HEX_BYTES (255) here, with the same
// "how many bytes were omitted" reporting when a pathological length field still needs capping.
//
// Run: npm run test:sniffer-payload

import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { MAX_PAYLOAD_HEX_BYTES as HCI_MAX, payloadToHex } from "./hci/hciParser"
import { hexCapped, MAX_PAYLOAD_HEX_BYTES as SNIFFER_MAX } from "./sniffer/nordicBleParser"

/** Build a buffer of `len` bytes with a recognizable, non-zero pattern (so zero-padding is actually exercised). */
function pattern(len: number): Buffer {
	const buf = Buffer.alloc(len)
	for (let i = 0; i < len; i++) buf[i] = i % 256
	return buf
}

function expectedHex(buf: Buffer, count: number): string {
	return Array.from(buf.subarray(0, count))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join(" ")
}

describe("MAX_PAYLOAD_HEX_BYTES", () => {
	test("is 255 in both the HCI and sniffer decode paths (BLE extended-advertising ceiling)", () => {
		assert.equal(HCI_MAX, 255)
		assert.equal(SNIFFER_MAX, 255)
	})
})

// One shared table so the HCI (payloadToHex) and sniffer (hexCapped) paths are proven to behave the same way.
const impls: { name: string; run: (buf: Buffer, len: number) => string }[] = [
	{ name: "hci/hciParser payloadToHex", run: (buf, len) => payloadToHex(buf, 0, len) },
	{ name: "sniffer/nordicBleParser hexCapped", run: (buf, len) => hexCapped(buf, 0, len) },
]

for (const { name, run } of impls) {
	describe(name, () => {
		test("a 31-byte legacy advertising payload survives COMPLETE (no ellipsis)", () => {
			const buf = pattern(31)
			const hex = run(buf, 31)
			assert.equal(hex, expectedHex(buf, 31))
			assert.ok(!hex.includes("…"), "31-byte legacy advertising payload must not be truncated")
		})

		test("a 16-byte payload is unchanged (the old boundary)", () => {
			const buf = pattern(16)
			const hex = run(buf, 16)
			assert.equal(hex, expectedHex(buf, 16))
			assert.ok(!hex.includes("…"))
		})

		test("a 255-byte extended advertising payload survives complete", () => {
			const buf = pattern(255)
			const hex = run(buf, 255)
			assert.equal(hex, expectedHex(buf, 255))
			assert.ok(!hex.includes("…"), "255-byte payload sits exactly at the cap and must not be truncated")
		})

		test("an absurd length (100_000) is capped AND reports the omitted byte count", () => {
			// The buffer itself can't hold 100,000 bytes of real capture data — this simulates a corrupt/
			// mis-synced length field claiming far more than was actually captured.
			const buf = pattern(300)
			const hex = run(buf, 100_000)
			const [hexPart, tail] = hex.split("…").map((s) => s.trim())
			assert.equal(hexPart, expectedHex(buf, 255), "shows exactly the first 255 bytes")
			assert.equal(tail, "+99745 bytes", "reports how many bytes were omitted (100000 - 255)")
		})

		test("hex formatting is unchanged: lowercase, space-separated, zero-padded", () => {
			const buf = Buffer.from([0x00, 0x0f, 0xab, 0xff])
			const hex = run(buf, 4)
			assert.equal(hex, "00 0f ab ff")
		})
	})
}
