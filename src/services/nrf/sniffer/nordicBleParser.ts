// Decodes the nRF Sniffer for Bluetooth LE PCAP (LINKTYPE_NORDIC_BLE, 272), UART protocol v3.
//
// Per-record layout, confirmed 2026-06-26 against a real capture (nrfutil ble-sniffer 0.17.1, sniffer
// firmware 4.1.1 on a PCA10059 dongle — see Adsum-Planning/operations/hardware-in-the-loop-testing.md).
// There is NO separate header_length byte — the meta prefix is a fixed 7 bytes; only the flags-block
// length (byte [7]) is still self-describing, so a flags-block change still degrades gracefully:
//   [0]      board id
//   [1..2]   payload_length (LE) — byte count of (flags-block + LL data) that follows byte [6]
//   [3]      protocol_version (=3)
//   [4..5]   packet_counter (LE)
//   [6]      packet_id
//   [7]      flags_block_length (=10)
//   [8]      flags  (bit0 CRC ok · bits1-2 aux type · bit3 addr resolved · bits4-6 PHY)
//   [9]      channel index
//   [10]     rssi   (magnitude; dBm = -value)
//   [11..12] event counter (LE)
//   [13..16] timestamp µs (LE)
//   [7+flags_block_length ..]  BLE Link Layer: access address(4 LE) + PDU header(2) + payload + CRC(3)

import type { SnifferEntry, SnifferField, SnifferParseResult } from "./snifferTypes"

const ADV_ACCESS_ADDRESS = 0x8e89bed6 // standard advertising-channel access address

// Legacy advertising PDU types (low nibble of the LL header byte 0).
const ADV_PDU: Record<number, string> = {
	0: "ADV_IND",
	1: "ADV_DIRECT_IND",
	2: "ADV_NONCONN_IND",
	3: "SCAN_REQ", // or AUX_SCAN_REQ
	4: "SCAN_RSP",
	5: "CONNECT_IND", // or AUX_CONNECT_REQ
	6: "ADV_SCAN_IND",
	7: "ADV_EXT_IND", // extended: AUX_ADV_IND / AUX_SYNC_IND / AUX_CHAIN_IND / AUX_SCAN_RSP
	8: "AUX_CONNECT_RSP",
}
// Legacy PDU types whose payload is a single advertiser address (first 6 bytes).
// NOTE: ADV_DIRECT_IND (0x1) is intentionally NOT here — it carries TWO addresses
// (AdvA + TargetA) and is decoded by its own branch below, like CONNECT_IND/SCAN_REQ.
const ADV_HAS_ADVA = new Set([0x0, 0x2, 0x4, 0x6])

// LL Control PDU opcodes (the ones worth naming for debugging).
const LL_CONTROL: Record<number, string> = {
	0: "LL_CONNECTION_UPDATE_IND",
	1: "LL_CHANNEL_MAP_IND",
	2: "LL_TERMINATE_IND",
	3: "LL_ENC_REQ",
	4: "LL_ENC_RSP",
	5: "LL_START_ENC_REQ",
	6: "LL_START_ENC_RSP",
	7: "LL_UNKNOWN_RSP",
	8: "LL_FEATURE_REQ",
	9: "LL_FEATURE_RSP",
	11: "LL_VERSION_IND",
	12: "LL_REJECT_IND",
	15: "LL_CONNECTION_PARAM_REQ",
	16: "LL_CONNECTION_PARAM_RSP",
	18: "LL_PING_REQ",
	19: "LL_PING_RSP",
	20: "LL_LENGTH_REQ",
	21: "LL_LENGTH_RSP",
	22: "LL_PHY_REQ",
	23: "LL_PHY_RSP",
	24: "LL_PHY_UPDATE_IND",
}

// Same HCI error table the controller uses for LL_TERMINATE_IND reasons (subset).
const LL_ERROR: Record<number, string> = {
	8: "Connection Timeout",
	19: "Remote User Terminated",
	22: "Terminated by Local Host",
	34: "LL Response Timeout",
	40: "Instant Passed",
	61: "MIC Failure",
	62: "Connection Failed to be Established",
}

function phyName(v: number): string {
	return v === 0 ? "1M" : v === 1 ? "2M" : v === 2 ? "Coded" : `0x${v.toString(16)}`
}

/** 6 little-endian bytes → "aa:bb:cc:dd:ee:ff". */
function macLE(buf: Buffer, off: number): string {
	const b: string[] = []
	for (let i = 5; i >= 0; i--) {
		b.push(buf[off + i].toString(16).padStart(2, "0"))
	}
	return b.join(":")
}

function hexCapped(buf: Buffer, off: number, len: number, cap = 16): string {
	const end = Math.min(off + cap, off + len, buf.length)
	const parts: string[] = []
	for (let i = off; i < end; i++) {
		parts.push(buf[i].toString(16).padStart(2, "0"))
	}
	if (len > cap) {
		parts.push("…")
	}
	return parts.join(" ")
}

/** Coarse, honest protocol label for the Wireshark-style "Proto" column — we decode link-layer only. */
type SnifferProto = SnifferEntry["proto"]

/** Decode the BLE Link-Layer PDU (access address + header + payload). */
function decodeLl(ll: Buffer): { pduType: string; summary: string; fields: SnifferField[]; len: number; proto: SnifferProto } {
	const fields: SnifferField[] = []
	if (ll.length < 6) {
		return { pduType: "malformed", summary: `LL too short (${ll.length}B)`, fields, len: 0, proto: "LL" }
	}
	const accessAddress = ll.readUInt32LE(0)
	const h0 = ll[4]
	const h1 = ll[5]
	const payOff = 6

	if (accessAddress === ADV_ACCESS_ADDRESS) {
		// Advertising-channel PDU.
		const type = h0 & 0x0f
		const txRandom = ((h0 >> 6) & 0x01) === 1
		const len = h1
		const name = ADV_PDU[type] ?? `ADV 0x${type.toString(16)}`
		fields.push({ name: "PDU", value: `${name} (TxAdd ${txRandom ? "Random" : "Public"})` })

		if (type === 0x5 && ll.length >= payOff + 12) {
			// CONNECT_IND: InitA(6) + AdvA(6) [+ LLData(22)] — the "a connection is starting" marker.
			const initA = macLE(ll, payOff)
			const advA = macLE(ll, payOff + 6)
			fields.push({ name: "Initiator", value: initA })
			fields.push({ name: "Advertiser", value: advA })
			return { pduType: name, summary: `CONNECT_IND ${initA} → ${advA}`, fields, len, proto: "ADV" }
		}
		if (type === 0x3 && ll.length >= payOff + 12) {
			// SCAN_REQ: ScanA(6) + AdvA(6)
			const scanA = macLE(ll, payOff)
			const advA = macLE(ll, payOff + 6)
			fields.push({ name: "Scanner", value: scanA })
			fields.push({ name: "Advertiser", value: advA })
			return { pduType: name, summary: `SCAN_REQ ${scanA} → ${advA}`, fields, len, proto: "ADV" }
		}
		if (type === 0x1 && ll.length >= payOff + 12) {
			// ADV_DIRECT_IND: AdvA(6) + TargetA(6) — directed advertising aimed at one specific peer.
			// Two addresses, so it can't go through the single-AdvA branch (that dropped TargetA).
			const advA = macLE(ll, payOff)
			const targetA = macLE(ll, payOff + 6)
			fields.push({ name: "Advertiser", value: advA })
			fields.push({ name: "Target", value: targetA })
			return { pduType: name, summary: `ADV_DIRECT_IND ${advA} → ${targetA}`, fields, len, proto: "ADV" }
		}
		if (ADV_HAS_ADVA.has(type) && ll.length >= payOff + 6) {
			const advA = macLE(ll, payOff)
			fields.push({ name: "Advertiser", value: advA })
			return { pduType: name, summary: `${name} from ${advA} (${len}B)`, fields, len, proto: "ADV" }
		}
		// Extended (0x7) and anything else: name + length only (ext header layout varies).
		return { pduType: name, summary: `${name} (${len}B)`, fields, len, proto: "ADV" }
	}

	// Data-channel PDU (a connection's access address). Header: LLID(2) NESN(1) SN(1) MD(1) RFU(3) | len.
	const llid = h0 & 0x03
	// Full second header octet (8-bit length) — BLE 4.2 Data Length Extension. Masking to 5 bits
	// (h1 & 0x1f) truncated any DLE frame (payload > 31B) to a wrong, smaller length.
	const len = h1
	const aaHex = `0x${accessAddress.toString(16).padStart(8, "0")}`
	fields.push({ name: "Access Address", value: aaHex })
	if (llid === 0x3) {
		// LL Control PDU: first payload byte is the opcode.
		const opcode = ll.length > payOff ? ll[payOff] : -1
		const opName = LL_CONTROL[opcode] ?? `LL_CTRL 0x${opcode >= 0 ? opcode.toString(16) : "??"}`
		fields.push({ name: "Control", value: opName })
		// LL_TERMINATE_IND carries an error code in the next byte.
		if (opcode === 0x02 && ll.length > payOff + 1) {
			const reason = ll[payOff + 1]
			const reasonName = LL_ERROR[reason] ?? `0x${reason.toString(16)}`
			fields.push({ name: "Reason", value: reasonName, isError: reason !== 0 })
			return { pduType: opName, summary: `${opName} reason=${reasonName}`, fields, len, proto: "LL-CTRL" }
		}
		return { pduType: opName, summary: opName, fields, len, proto: "LL-CTRL" }
	}
	if (llid === 0x1) {
		const proto: SnifferProto = len === 0 ? "LL(empty)" : "DATA"
		return { pduType: "LL Data", summary: len === 0 ? "LL Empty PDU" : `LL Data (cont) ${len}B`, fields, len, proto }
	}
	if (llid === 0x2) {
		return { pduType: "LL Data", summary: `LL Data (start) ${len}B`, fields, len, proto: "DATA" }
	}
	return { pduType: "LL", summary: `LL reserved PDU (${len}B)`, fields, len, proto: "LL" }
}

/** Fixed meta-prefix length: board id(1) + payload_length(2) + protocol_version(1) + packet_counter(2) + packet_id(1). */
const META_PREFIX_LEN = 7

/**
 * Parse one Nordic-BLE PCAP record blob → a SnifferEntry, or null if it isn't a valid v3 meta frame.
 * The flags-block length (byte [7]) is still self-describing, so the decode degrades gracefully if
 * that block grows; the meta prefix itself is a fixed 7 bytes (no header_length field — see the file
 * header comment for how this was confirmed against real hardware).
 */
export function parseNordicBleRecord(buf: Buffer, frameNo: number): SnifferEntry | null {
	if (buf.length < META_PREFIX_LEN + 1) {
		return null
	}
	const protocolVersion = buf[3]
	const flagsOff = META_PREFIX_LEN
	if (protocolVersion !== 3 || flagsOff + 10 > buf.length) {
		return null
	}
	const flagsBlockLen = buf[flagsOff]
	const flags = buf[flagsOff + 1]
	const channel = buf[flagsOff + 2]
	const rssi = buf[flagsOff + 3]
	const timestampUs = buf.readUInt32LE(flagsOff + 6)
	const bleStart = flagsOff + flagsBlockLen
	if (bleStart > buf.length) {
		return null
	}

	const crcOk = (flags & 0x01) === 1
	const phy = phyName((flags >> 4) & 0x07)
	const ll = buf.subarray(bleStart)
	const { pduType, summary, fields, len, proto } = decodeLl(ll)
	if (!crcOk) {
		fields.push({ name: "CRC", value: "FAILED", isError: true })
	}

	return {
		frameNo,
		tsMs: timestampUs / 1000,
		channel,
		rssiDbm: -rssi,
		phy,
		crcOk,
		pduType,
		summary,
		fields,
		pduLen: len,
		proto,
		payloadHex: hexCapped(ll, 4, Math.max(0, ll.length - 4)), // from the PDU header onward
	}
}

/** Decode all records from a parsed PCAP into structured sniffer entries. */
export function parseNordicBle(records: Buffer[], linkType?: number): SnifferParseResult {
	const entries: SnifferEntry[] = []
	let parseErrors = 0
	let frameNo = 0
	for (const rec of records) {
		const entry = parseNordicBleRecord(rec, frameNo + 1)
		if (entry) {
			frameNo++
			entries.push(entry)
		} else {
			parseErrors++
		}
	}
	let durationMs =
		entries.length >= 2 && entries[0].tsMs !== undefined && entries[entries.length - 1].tsMs !== undefined
			? entries[entries.length - 1].tsMs! - entries[0].tsMs!
			: undefined
	// The sniffer timestamp is a 32-bit µs counter that wraps (~71 min), so last < first yields a bogus
	// negative span. We can't know the wrap count, so report "unknown" rather than a wrong negative number.
	if (durationMs !== undefined && durationMs < 0) {
		durationMs = undefined
	}
	return { entries, totalFrames: frameNo, parseErrors, durationMs, linkType }
}
