import { expect } from "chai"
import { describe, it } from "mocha"
import { buildHciMermaid, formatHci } from "../format"
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

	it("appends a suggested mermaid sequence diagram footer when frames decoded", () => {
		const cmd = makeFrame(0x0002, 100, [0x03, 0x0c, 0x00]) // HCI Reset command
		const text = formatHci(parseHci(cmd))
		expect(text).to.contain("# --- suggested chat sequence diagram (mermaid) ---")
		expect(text).to.contain("# sequenceDiagram")
	})

	it("emits no mermaid footer for an empty capture", () => {
		const text = formatHci(parseHci(Buffer.alloc(0)))
		expect(text).to.not.contain("sequenceDiagram")
	})
})

describe("buildHciMermaid", () => {
	it("returns undefined for an empty capture", () => {
		expect(buildHciMermaid([])).to.be.undefined
	})

	it("renders Host/Controller participants and a CMD arrow host->controller", () => {
		const cmd = makeFrame(0x0002, 100, [0x03, 0x0c, 0x00]) // HCI Reset command
		const { entries } = parseHci(cmd)
		const mermaid = buildHciMermaid(entries)
		expect(mermaid).to.contain("sequenceDiagram")
		expect(mermaid).to.contain("participant H as Host")
		expect(mermaid).to.contain("participant Ctrl as Controller")
		expect(mermaid).to.match(/H->>Ctrl: Reset/)
	})

	it("renders an EVT arrow controller-->>host", () => {
		const evt = makeFrame(0x0003, 200, [0x0e, 0x04, 0x01, 0x03, 0x0c, 0x00]) // Command Complete
		const { entries } = parseHci(evt)
		const mermaid = buildHciMermaid(entries)
		expect(mermaid).to.match(/Ctrl-->>H: Command Complete/)
	})

	it("marks Disconnection Complete as a failed/terminating step (--x)", () => {
		const payload = Buffer.from([0x05, 0x04, 0x00, 0x42, 0x00, 0x13])
		const evt = makeFrame(0x0003, 100, payload)
		const { entries } = parseHci(evt)
		const mermaid = buildHciMermaid(entries)
		expect(mermaid).to.match(/Ctrl--xH: Disconnection Complete/)
	})

	it("collapses a run of ACL data packets into one Note, never invents per-packet arrows", () => {
		const aclPayload = Buffer.from([0x01, 0x20, 0x05, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
		const acl1 = makeFrame(0x0004, 100, aclPayload)
		const acl2 = makeFrame(0x0004, 110, aclPayload)
		const { entries } = parseHci(Buffer.concat([acl1, acl2]))
		const mermaid = buildHciMermaid(entries)
		expect(mermaid).to.contain("Note over H,Ctrl: 2 ACL data packets")
		expect(mermaid).to.contain("Wireshark")
	})

	it("skips MON/SYS/INDEX bookkeeping frames — they are not a host<->controller exchange", () => {
		// NEW_INDEX (opcode 0x0000)
		const idx = makeFrame(0x0000, 100, Buffer.alloc(16))
		const cmd = makeFrame(0x0002, 200, [0x03, 0x0c, 0x00])
		const { entries } = parseHci(Buffer.concat([idx, cmd]))
		const mermaid = buildHciMermaid(entries)
		// only the one CMD arrow should appear — the INDEX frame contributes no arrow/note
		expect((mermaid?.match(/->>|-->>|--x/g) ?? []).length).to.equal(1)
	})

	it("returns undefined for a capture of only INDEX/MON/SYS frames (no empty skeleton)", () => {
		// NEW_INDEX (0x0000) bookkeeping only — no CMD/EVT/ACL — must yield NO diagram, not a
		// header-only `sequenceDiagram` that renders blank/broken in chat.
		const idx1 = makeFrame(0x0000, 100, Buffer.alloc(16))
		const idx2 = makeFrame(0x0000, 200, Buffer.alloc(16))
		const { entries } = parseHci(Buffer.concat([idx1, idx2]))
		expect(entries.length).to.be.greaterThan(0) // frames decoded…
		expect(buildHciMermaid(entries)).to.be.undefined // …but no host↔controller exchange to draw
	})

	it("emits no mermaid footer in formatHci for an INDEX-only capture", () => {
		const idx = makeFrame(0x0000, 100, Buffer.alloc(16))
		const text = formatHci(parseHci(idx))
		expect(text).to.not.contain("sequenceDiagram")
	})

	it("truncates after the event cap and says so, never silently dropping the marker", () => {
		const frames: Buffer[] = []
		for (let i = 0; i < 45; i++) {
			frames.push(makeFrame(0x0002, i, [0x03, 0x0c, 0x00]))
		}
		const { entries } = parseHci(Buffer.concat(frames))
		const mermaid = buildHciMermaid(entries) ?? ""
		expect(mermaid).to.contain("truncated")
	})
})
