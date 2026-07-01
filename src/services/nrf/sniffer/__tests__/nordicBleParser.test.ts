import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"
import { buildSnifferMermaid, decodeSnifferPcap } from "../format"
import { parseNordicBle, parseNordicBleRecord } from "../nordicBleParser"
import { readPcap } from "../pcapReader"

// Build a Nordic-BLE PCAP record blob (UART protocol v3, real-hardware layout — see nordicBleParser.ts
// file header) around a BLE link-layer payload.
//   meta: board(1) plen(2) ver=3(1) counter(2) pktid(1) | flagsLen=10(1) flags(1) ch(1) rssi(1) evt(2) ts(4)
function metaFrame(opts: { channel: number; rssi: number; flags: number; tsUs: number; ll: Buffer }): Buffer {
	const head = Buffer.alloc(17)
	head[0] = 0 // board id
	head.writeUInt16LE(10 + opts.ll.length, 1) // payload length (informational; parser ignores)
	head[3] = 3 // protocol version
	head.writeUInt16LE(0, 4) // packet counter
	head[6] = 2 // packet id
	head[7] = 10 // flags block length
	head[8] = opts.flags
	head[9] = opts.channel
	head[10] = opts.rssi // magnitude; dBm = -rssi
	head.writeUInt16LE(0, 11) // event counter
	head.writeUInt32LE(opts.tsUs, 13) // timestamp µs
	return Buffer.concat([head, opts.ll])
}

// BLE link-layer PDU on the advertising access address (0x8e89bed6).
function advLl(h0: number, h1: number, payload: Buffer): Buffer {
	return Buffer.concat([Buffer.from([0xd6, 0xbe, 0x89, 0x8e]), Buffer.from([h0, h1]), payload, Buffer.from([0x71, 0xef, 0x4c])])
}
// BLE link-layer PDU on a connection access address.
function dataLl(accessAddrLE: number[], h0: number, h1: number, payload: Buffer): Buffer {
	return Buffer.concat([Buffer.from(accessAddrLE), Buffer.from([h0, h1]), payload, Buffer.from([0x00, 0x00, 0x00])])
}

const ADV_A = [0x30, 0x16, 0xef, 0x55, 0x0b, 0xd7] // little-endian → d7:0b:55:ef:16:30

function pcap(records: Buffer[], linkType = 272, bigEndian = false): Buffer {
	const gh = Buffer.alloc(24)
	const write32 = bigEndian ? gh.writeUInt32BE.bind(gh) : gh.writeUInt32LE.bind(gh)
	const write16 = bigEndian ? gh.writeUInt16BE.bind(gh) : gh.writeUInt16LE.bind(gh)
	write32(0xa1b2c3d4, 0) // classic pcap magic, µs (byte order of this field's own encoding signals endianness)
	write16(2, 4)
	write16(4, 6)
	write32(0xffff, 16) // snaplen
	write32(linkType, 20)
	const recs = records.map((d) => {
		const rh = Buffer.alloc(16)
		const rhWrite32 = bigEndian ? rh.writeUInt32BE.bind(rh) : rh.writeUInt32LE.bind(rh)
		rhWrite32(d.length, 8)
		rhWrite32(d.length, 12)
		return Buffer.concat([rh, d])
	})
	return Buffer.concat([gh, ...recs])
}

describe("nordicBleParser — meta header (real-frame ground truth)", () => {
	it("decodes ADV_NONCONN_IND: channel, RSSI, PHY, CRC, advertiser address", () => {
		// Real frame from a capture: ch38, RSSI -53, PDU 0x2, AdvA d7:0b:55:ef:16:30.
		const ll = advLl(0x42, 0x1d, Buffer.concat([Buffer.from(ADV_A), Buffer.from([0x02, 0x01, 0x06])]))
		const entry = parseNordicBleRecord(metaFrame({ channel: 38, rssi: 53, flags: 0x01, tsUs: 1_000_000, ll }), 1)
		expect(entry).to.not.equal(null)
		expect(entry!.channel).to.equal(38)
		expect(entry!.rssiDbm).to.equal(-53)
		expect(entry!.phy).to.equal("1M")
		expect(entry!.crcOk).to.equal(true)
		expect(entry!.pduType).to.equal("ADV_NONCONN_IND")
		expect(entry!.tsMs).to.equal(1000)
		expect(entry!.summary).to.contain("d7:0b:55:ef:16:30")
		expect(entry!.proto).to.equal("ADV")
		expect(entry!.pduLen).to.equal(0x1d)
	})

	it("reads the PHY field (Coded) and a failed CRC from flags", () => {
		const ll = advLl(0x42, 0x08, Buffer.from(ADV_A))
		// flags 0x20 → CRC bit clear, PHY bits (4-6) = 010 = Coded
		const entry = parseNordicBleRecord(metaFrame({ channel: 21, rssi: 81, flags: 0x20, tsUs: 0, ll }), 1)!
		expect(entry.phy).to.equal("Coded")
		expect(entry.crcOk).to.equal(false)
		expect(entry.rssiDbm).to.equal(-81)
		expect(entry.fields?.some((f) => f.name === "CRC" && f.isError)).to.equal(true)
	})

	it("rejects a non-v3 / truncated blob without throwing", () => {
		expect(parseNordicBleRecord(Buffer.from([0, 0, 0, 2 /* wrong version */, 0, 0, 0, 0]), 1)).to.equal(null)
		expect(parseNordicBleRecord(Buffer.alloc(4), 1)).to.equal(null)
	})
})

describe("nordicBleParser — link-layer PDUs", () => {
	it("decodes CONNECT_IND with initiator → advertiser (the connection-start marker)", () => {
		const initA = [0x01, 0xee, 0xdd, 0xcc, 0xbb, 0xaa] // → aa:bb:cc:dd:ee:01
		const ll = advLl(0x45, 0x22, Buffer.concat([Buffer.from(initA), Buffer.from(ADV_A), Buffer.alloc(22)]))
		const entry = parseNordicBleRecord(metaFrame({ channel: 37, rssi: 40, flags: 0x01, tsUs: 0, ll }), 1)!
		expect(entry.pduType).to.equal("CONNECT_IND")
		expect(entry.summary).to.contain("aa:bb:cc:dd:ee:01")
		expect(entry.summary).to.contain("d7:0b:55:ef:16:30")
		expect(entry.proto).to.equal("ADV")
	})

	it("decodes ADV_DIRECT_IND with both AdvA and TargetA (two-address PDU)", () => {
		// ADV_DIRECT_IND payload = AdvA(6) + TargetA(6). The advertiser is ADV_A; the directed target is targetA.
		const targetA = [0x09, 0xee, 0xdd, 0xcc, 0xbb, 0xaa] // → aa:bb:cc:dd:ee:09
		const ll = advLl(0x41, 0x0c, Buffer.concat([Buffer.from(ADV_A), Buffer.from(targetA)]))
		const entry = parseNordicBleRecord(metaFrame({ channel: 37, rssi: 45, flags: 0x01, tsUs: 0, ll }), 1)!
		expect(entry.pduType).to.equal("ADV_DIRECT_IND")
		expect(entry.summary).to.contain("d7:0b:55:ef:16:30") // AdvA (advertiser)
		expect(entry.summary).to.contain("aa:bb:cc:dd:ee:09") // TargetA (directed target) — must NOT be dropped
		expect(entry.fields?.some((f) => f.name === "Advertiser" && f.value === "d7:0b:55:ef:16:30")).to.equal(true)
		expect(entry.fields?.some((f) => f.name === "Target" && f.value === "aa:bb:cc:dd:ee:09")).to.equal(true)
		expect(entry.proto).to.equal("ADV")
	})

	it("decodes a data PDU length beyond 31 bytes (LE Data Length Extension)", () => {
		// h1 = 0xf5 (245). The old 5-bit mask (h1 & 0x1f) would truncate this to 21 — DLE frames are larger.
		const ll = dataLl([0x78, 0x56, 0x34, 0x12], 0x02 /* LLID start */, 0xf5, Buffer.alloc(8))
		const entry = parseNordicBleRecord(metaFrame({ channel: 6, rssi: 50, flags: 0x01, tsUs: 0, ll }), 1)!
		expect(entry.pduLen).to.equal(0xf5) // 245, not 0x15 (21)
		expect(entry.proto).to.equal("DATA")
	})

	it("decodes LL_TERMINATE_IND with a decoded reason code", () => {
		const ll = dataLl([0x78, 0x56, 0x34, 0x12], 0x03 /* LLID control */, 0x02, Buffer.from([0x02, 0x13]))
		const entry = parseNordicBleRecord(metaFrame({ channel: 10, rssi: 60, flags: 0x01, tsUs: 0, ll }), 1)!
		expect(entry.pduType).to.equal("LL_TERMINATE_IND")
		expect(entry.summary).to.contain("Remote User Terminated")
		expect(entry.fields?.some((f) => f.name === "Reason" && f.isError)).to.equal(true)
		expect(entry.proto).to.equal("LL-CTRL")
	})

	it("classifies an empty data PDU as LL(empty) with pduLen 0", () => {
		const ll = dataLl([0x78, 0x56, 0x34, 0x12], 0x01 /* LLID continue */, 0x00, Buffer.alloc(0))
		const entry = parseNordicBleRecord(metaFrame({ channel: 5, rssi: 50, flags: 0x01, tsUs: 0, ll }), 1)!
		expect(entry.proto).to.equal("LL(empty)")
		expect(entry.pduLen).to.equal(0)
	})

	it("classifies a non-empty data PDU as DATA", () => {
		const ll = dataLl([0x78, 0x56, 0x34, 0x12], 0x02 /* LLID start */, 0x05, Buffer.alloc(5))
		const entry = parseNordicBleRecord(metaFrame({ channel: 5, rssi: 50, flags: 0x01, tsUs: 0, ll }), 1)!
		expect(entry.proto).to.equal("DATA")
		expect(entry.pduLen).to.equal(5)
	})
})

describe("formatSniffer — Wireshark-style log (columns, legend, annotations)", () => {
	it("renders the column header, beginner legend, and Wireshark filter bridge", () => {
		const adv = metaFrame({ channel: 38, rssi: 53, flags: 1, tsUs: 0, ll: advLl(0x42, 0x1d, Buffer.from(ADV_A)) })
		const { text } = decodeSnifferPcap(pcap([adv]))
		expect(text).to.contain("Legend (beginner)")
		expect(text).to.contain("Δt(ms)")
		expect(text).to.contain("Wireshark bridge (expert)")
		expect(text).to.contain("!(btle.data_header.length==0)")
		expect(text).to.contain("Columns:")
	})

	it("annotates CONNECT_IND and LL_TERMINATE_IND inline for the beginner", () => {
		const conn = metaFrame({
			channel: 37,
			rssi: 40,
			flags: 1,
			tsUs: 0,
			ll: advLl(0x45, 0x22, Buffer.concat([Buffer.alloc(6), Buffer.from(ADV_A), Buffer.alloc(22)])),
		})
		const term = metaFrame({
			channel: 10,
			rssi: 60,
			flags: 1,
			tsUs: 1000,
			ll: dataLl([0x78, 0x56, 0x34, 0x12], 0x03, 0x02, Buffer.from([0x02, 0x13])),
		})
		const { text } = decodeSnifferPcap(pcap([conn, term]))
		expect(text).to.contain("← connection starts")
		expect(text).to.contain("← connection ends")
	})
})

describe("buildSnifferMermaid — deterministic sequence diagram from decoded packets only", () => {
	it("returns undefined for an empty capture", () => {
		expect(buildSnifferMermaid([])).to.equal(undefined)
	})

	it("builds Central/Peripheral lifelines from CONNECT_IND and arrows for lifecycle frames", () => {
		const adv = metaFrame({ channel: 38, rssi: 53, flags: 1, tsUs: 0, ll: advLl(0x42, 0x1d, Buffer.from(ADV_A)) })
		const initA = [0x01, 0xee, 0xdd, 0xcc, 0xbb, 0xaa]
		const conn = metaFrame({
			channel: 37,
			rssi: 40,
			flags: 1,
			tsUs: 10,
			ll: advLl(0x45, 0x22, Buffer.concat([Buffer.from(initA), Buffer.from(ADV_A), Buffer.alloc(22)])),
		})
		const term = metaFrame({
			channel: 10,
			rssi: 60,
			flags: 1,
			tsUs: 20,
			ll: dataLl([0x78, 0x56, 0x34, 0x12], 0x03, 0x02, Buffer.from([0x02, 0x13])),
		})
		const { result } = decodeSnifferPcap(pcap([adv, conn, term]))
		const mermaid = buildSnifferMermaid(result.entries)!
		expect(mermaid).to.contain("sequenceDiagram")
		expect(mermaid).to.contain("participant C as Central (aa:bb:cc:dd:ee:01)")
		expect(mermaid).to.contain("participant P as Peripheral (d7:0b:55:ef:16:30)")
		expect(mermaid).to.contain("P->>C: ADV_NONCONN_IND")
		expect(mermaid).to.contain("C->>P: CONNECT_IND")
		expect(mermaid).to.contain("C--xP: LL_TERMINATE_IND (Remote User Terminated)")
	})

	it("collapses a run of empty keep-alive PDUs into one Note", () => {
		const empties = Array.from({ length: 5 }, (_, i) =>
			metaFrame({
				channel: 5,
				rssi: 50,
				flags: 1,
				tsUs: i * 10,
				ll: dataLl([0x78, 0x56, 0x34, 0x12], 0x01, 0x00, Buffer.alloc(0)),
			}),
		)
		const { result } = decodeSnifferPcap(pcap(empties))
		const mermaid = buildSnifferMermaid(result.entries)!
		expect(mermaid).to.contain("Note over C,P: 5 empty keep-alive PDUs")
	})

	it("never invents a packet that wasn't decoded (only emits arrows for entries present)", () => {
		const adv = metaFrame({ channel: 38, rssi: 53, flags: 1, tsUs: 0, ll: advLl(0x42, 0x1d, Buffer.from(ADV_A)) })
		const { result } = decodeSnifferPcap(pcap([adv]))
		const mermaid = buildSnifferMermaid(result.entries)!
		expect(mermaid).to.contain("P->>C: ADV_NONCONN_IND")
		expect(mermaid).to.not.contain("CONNECT_IND")
		expect(mermaid).to.not.contain("TERMINATE")
	})
})

describe("pcapReader + full decode", () => {
	it("reads a classic PCAP and reports the Nordic link type", () => {
		const file = readPcap(
			pcap(
				[advLl(0x42, 0x1d, Buffer.from(ADV_A))].map((ll) => metaFrame({ channel: 38, rssi: 53, flags: 1, tsUs: 0, ll })),
			),
		)
		expect(file).to.not.equal(null)
		expect(file!.linkType).to.equal(272)
		expect(file!.records.length).to.equal(1)
	})

	it("decodeSnifferPcap renders both frames and counts them", () => {
		const adv = metaFrame({ channel: 38, rssi: 53, flags: 1, tsUs: 0, ll: advLl(0x42, 0x1d, Buffer.from(ADV_A)) })
		const conn = metaFrame({
			channel: 37,
			rssi: 40,
			flags: 1,
			tsUs: 5000,
			ll: advLl(0x45, 0x22, Buffer.concat([Buffer.alloc(6), Buffer.from(ADV_A), Buffer.alloc(22)])),
		})
		const { text, result } = decodeSnifferPcap(pcap([adv, conn]))
		expect(result.totalFrames).to.equal(2)
		expect(result.parseErrors).to.equal(0)
		expect(text).to.contain("ADV_NONCONN_IND")
		expect(text).to.contain("CONNECT_IND")
		expect(text).to.contain("over-the-air sniffer decode")
	})

	it("reads a big-endian-encoded classic PCAP (the real nrfutil ble-sniffer build's encoding)", () => {
		const adv = metaFrame({ channel: 38, rssi: 53, flags: 1, tsUs: 0, ll: advLl(0x42, 0x1d, Buffer.from(ADV_A)) })
		const file = readPcap(pcap([adv], 272, /* bigEndian */ true))
		expect(file).to.not.equal(null)
		expect(file!.linkType).to.equal(272)
		expect(file!.records.length).to.equal(1)
		const entry = parseNordicBleRecord(file!.records[0].data, 1)
		expect(entry).to.not.equal(null)
		expect(entry!.pduType).to.equal("ADV_NONCONN_IND")
	})

	it("returns a clear note for a non-PCAP buffer (no throw)", () => {
		const { text, result } = decodeSnifferPcap(Buffer.from("not a pcap file at all"))
		expect(result.totalFrames).to.equal(0)
		expect(text).to.contain("could not read the PCAP")
	})

	it("parseNordicBle counts undecodable records as parseErrors", () => {
		const good = metaFrame({ channel: 38, rssi: 53, flags: 1, tsUs: 0, ll: advLl(0x42, 0x1d, Buffer.from(ADV_A)) })
		const bad = Buffer.from([0, 6, 0, 0, 9]) // wrong protocol version
		const res = parseNordicBle([good, bad], 272)
		expect(res.totalFrames).to.equal(1)
		expect(res.parseErrors).to.equal(1)
	})
})

describe("real hardware fixture (captured via assets/scripts/nrf-sniffer on a flashed PCA10059 dongle)", () => {
	it("decodes every record from a real capture with no parse errors", () => {
		const buf = fs.readFileSync(path.join(__dirname, "fixtures", "real-adv-and-scan.pcap"))
		const { text, result } = decodeSnifferPcap(buf)
		expect(result.parseErrors).to.equal(0)
		expect(result.totalFrames).to.be.greaterThan(1800)
		expect(text).to.contain("ADV_IND")
		expect(text).to.contain("SCAN_REQ")
		expect(text).to.contain("sequenceDiagram")
	})
})
