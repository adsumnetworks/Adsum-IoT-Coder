import { expect } from "chai"
import { describe, it } from "mocha"
import { parseHci } from "../hciParser"

// Helper: build a BT Monitor frame the way Zephyr does.
//   [2B data_len LE][2B opcode LE][1B flags][1B hdr_len=5]
//   [1B TLV type 0x08][4B ts32 LE]
//   [payload...]
// data_len = 4 + hdr_len + payload.length  (opcode + flags + hdr_len + ext_hdr + payload)
function makeFrame(opcode: number, ts32: number, payload: Buffer | number[]): Buffer {
	const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
	const hdrLen = 5
	const dataLen = 4 + hdrLen + payloadBuf.length
	const frame = Buffer.alloc(2 + dataLen)
	frame.writeUInt16LE(dataLen, 0)
	frame.writeUInt16LE(opcode, 2)
	frame.writeUInt8(0, 4) // flags
	frame.writeUInt8(hdrLen, 5)
	frame.writeUInt8(0x08, 6) // TLV: ts32 type
	frame.writeUInt32LE(ts32, 7)
	payloadBuf.copy(frame, 11)
	return frame
}

describe("hciParser", () => {
	describe("frame structure", () => {
		it("computes totalFrame as 2 + data_len (Zephyr btmon convention)", () => {
			// HCI Reset CMD: opcode 0x0c03, plen 0 → 3-byte payload
			const cmdPayload = Buffer.from([0x03, 0x0c, 0x00])
			const frame = makeFrame(0x0002, 100, cmdPayload)
			expect(frame.length).to.equal(2 + 4 + 5 + 3) // 14 bytes total

			const { entries } = parseHci(frame)
			expect(entries.length).to.equal(1)
			expect(entries[0].type).to.equal("CMD")
		})

		it("uses hdr_len directly (NOT hdr_len - 2) for ext_hdr length", () => {
			// Regression test: original parser had `extHdrLen = hdrLen - 2` which was wrong.
			// Build a frame where the 5-byte ext_hdr contains a real timestamp,
			// so the parser must skip exactly 5 bytes before reading the payload.
			const cmdPayload = Buffer.from([0x01, 0x10, 0x00]) // Read Local Version (0x1001)
			const frame = makeFrame(0x0002, 12345, cmdPayload)
			const { entries } = parseHci(frame)
			expect(entries.length).to.equal(1)
			expect(entries[0].summary).to.match(/TX CMD Read Local Version Information/)
		})

		it("payload size = data_len − 4 − hdr_len", () => {
			// 10-byte payload (HCI CMD with 7 bytes of params)
			const cmdPayload = Buffer.alloc(10)
			cmdPayload.writeUInt16LE(0x2008, 0) // LE Set Adv Data
			cmdPayload[2] = 7 // param length
			const frame = makeFrame(0x0002, 0, cmdPayload)
			const { entries } = parseHci(frame)
			expect(entries[0].payloadLen).to.equal(10)
		})

		it("parses sequential frames at correct offsets", () => {
			const f1 = makeFrame(0x0002, 100, [0x03, 0x0c, 0x00])
			const f2 = makeFrame(0x0003, 200, [0x0e, 0x04, 0x01, 0x03, 0x0c, 0x00])
			const combined = Buffer.concat([f1, f2])
			const { entries } = parseHci(combined)
			expect(entries.length).to.equal(2)
			expect(entries[0].type).to.equal("CMD")
			expect(entries[1].type).to.equal("EVT")
		})
	})

	describe("timestamp extraction", () => {
		it("extracts ts32 from TLV (type 0x08) in 100µs units, converts to ms", () => {
			// ts32 = 280 → 280 * 100 = 28000 µs = 28 ms
			const frame = makeFrame(0x0002, 280, [0x03, 0x0c, 0x00])
			const { entries } = parseHci(frame)
			expect(entries[0].elapsedMs).to.equal(28)
		})

		it("returns ABSOLUTE device uptime, not delta from first frame", () => {
			// Regression: original parser computed elapsedMs as (tick - firstTick),
			// making the first frame always 0. LogScope-style is absolute uptime.
			const f1 = makeFrame(0x0002, 280, [0x03, 0x0c, 0x00]) // 28 ms
			const f2 = makeFrame(0x0003, 290, [0x0e, 0x04, 0x01, 0x03, 0x0c, 0x00]) // 29 ms
			const { entries } = parseHci(Buffer.concat([f1, f2]))
			expect(entries[0].elapsedMs).to.equal(28) // not 0
			expect(entries[1].elapsedMs).to.equal(29) // not 1
		})

		it("returns undefined elapsedMs when no TLV timestamp is present", () => {
			// Frame with hdr_len = 0 (no ext_hdr)
			const payload = Buffer.from([0x03, 0x0c, 0x00])
			const dataLen = 4 + 0 + payload.length
			const frame = Buffer.alloc(2 + dataLen)
			frame.writeUInt16LE(dataLen, 0)
			frame.writeUInt16LE(0x0002, 2)
			frame.writeUInt8(0, 4)
			frame.writeUInt8(0, 5) // hdr_len = 0
			payload.copy(frame, 6)
			const { entries } = parseHci(frame)
			expect(entries[0].elapsedMs).to.be.undefined
		})
	})

	describe("CMD decoding (LogScope format)", () => {
		it("decodes Reset (0x0c03) as 'TX CMD Reset (0B)'", () => {
			const frame = makeFrame(0x0002, 100, [0x03, 0x0c, 0x00])
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.equal("TX CMD Reset (0B)")
		})

		it("decodes LE Set PHY (0x2032) by name", () => {
			const frame = makeFrame(0x0002, 100, [0x32, 0x20, 0x00])
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.equal("TX CMD LE Set PHY (0B)")
		})

		it("includes param length from the HCI opcode header", () => {
			// 5 bytes of params after opcode + plen byte
			const payload = Buffer.concat([Buffer.from([0x06, 0x20, 0x05]), Buffer.alloc(5)])
			const frame = makeFrame(0x0002, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.equal("TX CMD LE Set Advertising Parameters (5B)")
		})

		it("falls back to 'Unknown Command (0x...)' for opcodes not in the table", () => {
			const frame = makeFrame(0x0002, 100, [0x00, 0xab, 0x00]) // opcode 0xab00 — vendor specific, not in our table
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.equal("TX CMD Unknown Command (0xAB00) (0B)")
		})
	})

	describe("EVT decoding (LogScope format)", () => {
		it("decodes Command Complete with the inner command name + status", () => {
			// EVT 0x0e, plen 4, num_pkts 1, cmd_opcode 0x0c03 (Reset), status 0 (Success)
			const payload = Buffer.from([0x0e, 0x04, 0x01, 0x03, 0x0c, 0x00])
			const frame = makeFrame(0x0003, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.equal("RX EVT Command Complete Reset (status: Success)")
		})

		it("shows non-success status with friendly error name when in the HCI error table", () => {
			// 0x12 = Invalid HCI Parameters
			const payload = Buffer.from([0x0e, 0x04, 0x01, 0x03, 0x0c, 0x12])
			const frame = makeFrame(0x0003, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.equal("RX EVT Command Complete Reset (status: Invalid HCI Parameters)")
		})

		it("falls back to 'Error 0xNN' for unknown status codes", () => {
			// 0xee = not in our HCI_ERROR table
			const payload = Buffer.from([0x0e, 0x04, 0x01, 0x03, 0x0c, 0xee])
			const frame = makeFrame(0x0003, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.equal("RX EVT Command Complete Reset (status: Error 0xEE)")
		})

		it("decodes Command Status with status field", () => {
			// EVT 0x0f, plen 4, status 0, num_pkts 1, cmd_opcode 0x200d (LE Create Connection)
			const payload = Buffer.from([0x0f, 0x04, 0x00, 0x01, 0x0d, 0x20])
			const frame = makeFrame(0x0003, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.match(/RX EVT Command Status LE Create Connection/)
			expect(entries[0].summary).to.include("Success")
		})

		it("decodes LE Meta Connection Complete with handle", () => {
			// EVT 0x3e, plen 19, subevent 0x01 (LE Connection Complete), status 0, handle 0x0001
			const payload = Buffer.from([0x3e, 0x13, 0x01, 0x00, 0x01, 0x00, ...new Array(15).fill(0)])
			const frame = makeFrame(0x0003, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.match(/RX EVT LE Connection Complete handle=0x0001/)
		})

		it("decodes LE Meta PHY Update Complete with TX/RX PHY", () => {
			// subevent 0x0c, status 0, handle 0x0001, tx_phy 2 (2M), rx_phy 2 (2M)
			const payload = Buffer.from([0x3e, 0x06, 0x0c, 0x00, 0x01, 0x00, 0x02, 0x02])
			const frame = makeFrame(0x0003, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.match(/LE PHY Update Complete TX=2M RX=2M/)
		})

		it("decodes Disconnection Complete with handle + reason (resolved to friendly name)", () => {
			// EVT 0x05, plen 4, status 0, handle 0x0042, reason 0x13 (remote user terminated)
			const payload = Buffer.from([0x05, 0x04, 0x00, 0x42, 0x00, 0x13])
			const frame = makeFrame(0x0003, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.match(/Disconnection Complete handle=0x0042/)
			expect(entries[0].summary).to.include("Remote User Terminated Connection")
		})
	})

	describe("ACL decoding", () => {
		it("decodes ACL_TX direction as 'TX ACL'", () => {
			// handle 0x0001, PB=2 (start), data_len 5
			const payload = Buffer.from([0x01, 0x20, 0x05, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
			const frame = makeFrame(0x0004, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.match(/^TX ACL handle=0x0001/)
		})

		it("decodes ACL_RX direction as 'RX ACL'", () => {
			const payload = Buffer.from([0x01, 0x20, 0x05, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
			const frame = makeFrame(0x0005, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].summary).to.match(/^RX ACL handle=0x0001/)
		})
	})

	describe("SYS / MON / INDEX (text/system) decoding", () => {
		it("decodes BT_MONITOR_USER_LOGGING (opcode 0x000d) with [ident] msg format", () => {
			// Zephyr USER_LOGGING frame: [priority:1][ident_len:1][ident bytes][msg bytes]
			// priority=5 (INF), ident_len=2, ident="bt", msg="peripheral_uart: started"
			const payload = Buffer.from([
				0x05, // priority
				0x02, // ident_len
				0x62,
				0x74, // "bt"
				...Buffer.from("peripheral_uart: started", "utf8"),
			])
			const frame = makeFrame(0x000d, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].type).to.equal("MON")
			expect(entries[0].summary).to.equal("[bt] peripheral_uart: started")
		})

		it("decodes SYS note (opcode 0x000c) as text", () => {
			const payload = Buffer.from("system note", "utf8")
			const frame = makeFrame(0x000c, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].type).to.equal("SYS")
			expect(entries[0].summary).to.equal("system note")
		})

		it("decodes NEW_INDEX (opcode 0x0000) by extracting the controller name from payload bytes 8..15", () => {
			// bus(1) + type(1) + bdaddr(6) + name(8="SDC" + 5 nulls)
			const payload = Buffer.from([
				0x00,
				0x00, // bus, type
				0x00,
				0x00,
				0x00,
				0x00,
				0x00,
				0x00, // bdaddr
				0x53,
				0x44,
				0x43,
				0x00,
				0x00,
				0x00,
				0x00,
				0x00, // "SDC" + nulls
			])
			const frame = makeFrame(0x0000, 27, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].type).to.equal("INDEX")
			expect(entries[0].summary).to.equal("HCI Index: SDC")
		})

		it("shows generic 'BT Monitor opcode 0xNN (NB)' for unknown opcodes (e.g. 0x0008 vendor diag)", () => {
			const payload = Buffer.from([])
			const frame = makeFrame(0x0008, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].type).to.equal("SYS")
			expect(entries[0].summary).to.equal("BT Monitor opcode 0x08 (0B)")
		})
	})

	describe("robustness against garbage data", () => {
		it("skips circular-buffer prefill (data_len < 4)", () => {
			// All-zero buffer — data_len=0 means garbage, parser must NOT treat it as a valid frame
			const garbage = Buffer.alloc(50)
			const { entries, parseErrors } = parseHci(garbage)
			expect(entries.length).to.equal(0)
			expect(parseErrors).to.be.greaterThan(0)
		})

		it("does not get stuck in infinite loop on zero-length frames", () => {
			const garbage = Buffer.alloc(1000)
			const start = Date.now()
			const { entries } = parseHci(garbage)
			expect(Date.now() - start).to.be.lessThan(1000) // completes in <1s
			expect(entries.length).to.equal(0)
		})

		it("recovers when a frame would overrun the buffer", () => {
			// Build a frame claiming data_len=100 but only have 10 bytes
			const truncated = Buffer.alloc(10)
			truncated.writeUInt16LE(100, 0) // claim 100 bytes
			truncated.writeUInt16LE(0x0002, 2)
			truncated.writeUInt8(5, 5)
			const { entries } = parseHci(truncated)
			// Should not crash, should resync or skip
			expect(entries.length).to.equal(0)
		})

		it("interleaves valid frames after garbage prefix", () => {
			// Real-world btmon files often have leading zeros from the circular buffer
			const garbage = Buffer.alloc(20)
			const validFrame = makeFrame(0x0002, 100, [0x03, 0x0c, 0x00])
			const buf = Buffer.concat([garbage, validFrame])
			const { entries } = parseHci(buf)
			expect(entries.length).to.be.at.least(1)
			expect(entries[entries.length - 1].summary).to.match(/TX CMD Reset/)
		})
	})

	describe("structured decoded fields (drives ▶ expand arrow)", () => {
		it("Command Complete (0x0e) produces Num Packets / Command / Status fields", () => {
			// num_pkts=1, cmd_opcode=0x0c03 (Reset), status=0 (Success)
			const payload = Buffer.from([0x0e, 0x04, 0x01, 0x03, 0x0c, 0x00])
			const frame = makeFrame(0x0003, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].decoded).to.exist
			expect(entries[0].decoded!.fields).to.deep.equal([
				{ name: "Num Packets", value: "1" },
				{ name: "Command", value: "Reset" },
				{ name: "Status", value: "Success" },
			])
		})

		it("Command Complete with non-zero status marks Status field as isError", () => {
			const payload = Buffer.from([0x0e, 0x04, 0x01, 0x03, 0x0c, 0x12])
			const frame = makeFrame(0x0003, 100, payload)
			const { entries } = parseHci(frame)
			const statusField = entries[0].decoded!.fields.find((f) => f.name === "Status")!
			expect(statusField.isError).to.be.true
			expect(statusField.value).to.equal("Invalid HCI Parameters")
		})

		it("CMD rows do NOT have decoded fields (no ▶ arrow)", () => {
			// Regression guard: LogScope only expands EVT rows in the user's reference UI
			const frame = makeFrame(0x0002, 100, [0x03, 0x0c, 0x00])
			const { entries } = parseHci(frame)
			expect(entries[0].decoded).to.be.undefined
		})

		it("MON / SYS / INDEX rows do NOT have decoded fields", () => {
			const monFrame = makeFrame(0x000d, 100, Buffer.from([0x05, 0x02, 0x62, 0x74, 0x68, 0x69]))
			const sysFrame = makeFrame(0x000c, 101, Buffer.from("note", "utf8"))
			const idxFrame = makeFrame(0x0000, 102, Buffer.alloc(16))
			const { entries } = parseHci(Buffer.concat([monFrame, sysFrame, idxFrame]))
			entries.forEach((e) => expect(e.decoded, e.summary).to.be.undefined)
		})
	})

	describe("payload hex dump", () => {
		it("populates payloadHex with space-separated bytes", () => {
			const payload = Buffer.from([0x03, 0x0c, 0x00])
			const frame = makeFrame(0x0002, 100, payload)
			const { entries } = parseHci(frame)
			expect(entries[0].payloadHex).to.equal("03 0c 00")
		})

		it("truncates hex dump at 16 bytes with ellipsis", () => {
			const payload = Buffer.alloc(20).fill(0xaa)
			const frame = makeFrame(0x0002, 100, Buffer.concat([Buffer.from([0x03, 0x0c, 17]), payload]))
			const { entries } = parseHci(frame)
			expect(entries[0].payloadHex).to.include("…")
			expect(entries[0].payloadHex.split(" ").length).to.equal(17) // 16 bytes + "…"
		})
	})
})
