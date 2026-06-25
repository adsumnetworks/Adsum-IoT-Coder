import { expect } from "chai"
import { describe, it } from "mocha"
import { decodeSnifferPcap } from "../format"
import { parseNordicBle, parseNordicBleRecord } from "../nordicBleParser"
import { readPcap } from "../pcapReader"

// Build a Nordic-BLE PCAP record blob (UART protocol v3) around a BLE link-layer payload.
//   meta: board(1) hlen=6(1) plen(2) ver=3(1) counter(2) pktid(1) | flagsLen=10(1) flags(1) ch(1) rssi(1) evt(2) ts(4)
function metaFrame(opts: { channel: number; rssi: number; flags: number; tsUs: number; ll: Buffer }): Buffer {
	const head = Buffer.alloc(18)
	head[0] = 0 // board id
	head[1] = 6 // header length
	head.writeUInt16LE(1 + 10 + opts.ll.length, 2) // payload length (informational; parser ignores)
	head[4] = 3 // protocol version
	head.writeUInt16LE(0, 5) // packet counter
	head[7] = 2 // packet id
	head[8] = 10 // flags block length
	head[9] = opts.flags
	head[10] = opts.channel
	head[11] = opts.rssi // magnitude; dBm = -rssi
	head.writeUInt16LE(0, 12) // event counter
	head.writeUInt32LE(opts.tsUs, 14) // timestamp µs
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

function pcap(records: Buffer[], linkType = 272): Buffer {
	const gh = Buffer.alloc(24)
	gh.writeUInt32LE(0xa1b2c3d4, 0) // classic pcap magic, µs, LE
	gh.writeUInt16LE(2, 4)
	gh.writeUInt16LE(4, 6)
	gh.writeUInt32LE(0xffff, 16) // snaplen
	gh.writeUInt32LE(linkType, 20)
	const recs = records.map((d) => {
		const rh = Buffer.alloc(16)
		rh.writeUInt32LE(d.length, 8)
		rh.writeUInt32LE(d.length, 12)
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
		expect(parseNordicBleRecord(Buffer.from([0, 6, 0, 0, 2 /* wrong version */]), 1)).to.equal(null)
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
	})

	it("decodes LL_TERMINATE_IND with a decoded reason code", () => {
		const ll = dataLl([0x78, 0x56, 0x34, 0x12], 0x03 /* LLID control */, 0x02, Buffer.from([0x02, 0x13]))
		const entry = parseNordicBleRecord(metaFrame({ channel: 10, rssi: 60, flags: 0x01, tsUs: 0, ll }), 1)!
		expect(entry.pduType).to.equal("LL_TERMINATE_IND")
		expect(entry.summary).to.contain("Remote User Terminated")
		expect(entry.fields?.some((f) => f.name === "Reason" && f.isError)).to.equal(true)
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
