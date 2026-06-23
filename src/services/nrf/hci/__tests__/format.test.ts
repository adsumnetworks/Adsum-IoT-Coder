import { expect } from "chai"
import { describe, it } from "mocha"
import { formatHci } from "../format"
import { parseHci } from "../hciParser"

// Same BT Monitor frame builder as hciParser.test.ts.
//   [2B data_len LE][2B opcode LE][1B flags][1B hdr_len=5][1B TLV 0x08][4B ts32 LE][payload...]
function makeFrame(opcode: number, ts32: number, payload: Buffer | number[]): Buffer {
	const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
	const hdrLen = 5
	const dataLen = 4 + hdrLen + payloadBuf.length
	const frame = Buffer.alloc(2 + dataLen)
	frame.writeUInt16LE(dataLen, 0)
	frame.writeUInt16LE(opcode, 2)
	frame.writeUInt8(0, 4)
	frame.writeUInt8(hdrLen, 5)
	frame.writeUInt8(0x08, 6)
	frame.writeUInt32LE(ts32, 7)
	payloadBuf.copy(frame, 11)
	return frame
}

describe("formatHci", () => {
	it("renders a header with frame count and the layer legend", () => {
		const cmd = makeFrame(0x0002, 100, [0x03, 0x0c, 0x00]) // HCI Reset command
		const text = formatHci(parseHci(cmd))
		expect(text).to.match(/# HCI Monitor decode/)
		expect(text).to.match(/1 frames/)
		expect(text).to.contain("CMD host→ctrl")
	})

	it("emits one line per frame with direction + type + code", () => {
		const f1 = makeFrame(0x0002, 100, [0x03, 0x0c, 0x00]) // CMD
		const f2 = makeFrame(0x0003, 200, [0x0e, 0x04, 0x01, 0x03, 0x0c, 0x00]) // EVT Command Complete
		const text = formatHci(parseHci(Buffer.concat([f1, f2])))
		expect(text).to.contain("#    1")
		expect(text).to.contain("#    2")
		expect(text).to.contain("host → ctrl")
		expect(text).to.contain("ctrl → host")
		expect(text).to.contain("CMD")
		expect(text).to.contain("EVT")
	})

	it("indents the per-field decode for events that have one", () => {
		// EVT Command Complete (0x0e) carries a decoded status field.
		const evt = makeFrame(0x0003, 200, [0x0e, 0x04, 0x01, 0x03, 0x0c, 0x00])
		const text = formatHci(parseHci(evt))
		// decoded fields are indented under the frame line
		expect(text).to.match(/\n {7,}\S/)
	})

	it("formats uptime as HH:MM:SS.mmm and falls back when no timestamp", () => {
		const text = formatHci(parseHci(makeFrame(0x0002, 1_234_500, [0x03, 0x0c, 0x00]))) // 123450 → 00:02:03.450
		expect(text).to.contain("00:02:03.450")
	})

	it("notes an empty capture explicitly (no silent blank)", () => {
		const text = formatHci(parseHci(Buffer.alloc(0)))
		expect(text).to.match(/no HCI frames decoded/)
	})

	it("shows the parser's capped payload hex (16 bytes + ellipsis) for a long payload", () => {
		const big = Buffer.alloc(80)
		big.writeUInt16LE(0x2008, 0) // LE Set Adv Data, long payload
		const text = formatHci(parseHci(makeFrame(0x0002, 0, big)))
		expect(text).to.contain("payload:")
		expect(text).to.contain("…") // parser truncates >16 bytes with an ellipsis
	})
})
