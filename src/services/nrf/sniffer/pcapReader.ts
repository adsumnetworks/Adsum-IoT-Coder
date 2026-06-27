// Minimal classic-PCAP reader for the nRF Sniffer output (`nrfutil ble-sniffer sniff --output-pcap-file`).
// nrfutil writes a classic .pcap (global header + records), link type 272 = LINKTYPE_NORDIC_BLE.
// We only need framing here; the per-record bytes are decoded by nordicBleParser.ts.

export const LINKTYPE_NORDIC_BLE = 272

export interface PcapRecord {
	/** Capture timestamp (seconds + microseconds since epoch) from the record header. */
	tsSec: number
	tsUsec: number
	/** The captured packet bytes (the Nordic BLE blob). */
	data: Buffer
}

export interface PcapFile {
	linkType: number
	/** True if the magic was nanosecond-resolution (tsUsec field is actually nanoseconds). */
	nanos: boolean
	records: PcapRecord[]
	/** Records skipped because their header/length was inconsistent with the buffer. */
	truncated: number
}

const MAGIC_LE_US = 0xa1b2c3d4 // little-endian, microsecond
const MAGIC_LE_NS = 0xa1b23c4d // little-endian, nanosecond
const MAGIC_PCAPNG = 0x0a0d0d0a // pcapng Section Header Block — not supported here

/**
 * Parse a classic PCAP buffer. Returns null only if the buffer is not a classic PCAP we can read
 * (too short, or pcapng). Endianness is taken from the magic number; both µs and ns magics handled.
 */
export function readPcap(buf: Buffer): PcapFile | null {
	if (buf.length < 24) {
		return null
	}

	// Detect endianness + resolution from the 32-bit magic.
	const magicLE = buf.readUInt32LE(0)
	const magicBE = buf.readUInt32BE(0)
	let le: boolean
	let nanos: boolean
	if (magicLE === MAGIC_LE_US || magicLE === MAGIC_LE_NS) {
		le = true
		nanos = magicLE === MAGIC_LE_NS
	} else if (magicBE === MAGIC_LE_US || magicBE === MAGIC_LE_NS) {
		le = false
		nanos = magicBE === MAGIC_LE_NS
	} else if (magicLE === MAGIC_PCAPNG || magicBE === MAGIC_PCAPNG) {
		return null // pcapng — nrfutil writes classic pcap, so this is unexpected; caller surfaces it
	} else {
		return null
	}

	const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o))
	const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))

	// Global header: magic(4) verMajor(2) verMinor(2) thiszone(4) sigfigs(4) snaplen(4) network(4)
	void u16 // version fields unused
	const linkType = u32(20)

	const records: PcapRecord[] = []
	let truncated = 0
	let off = 24
	while (off + 16 <= buf.length) {
		const tsSec = u32(off)
		const tsUsec = u32(off + 4)
		const inclLen = u32(off + 8)
		// orig_len at off+12 (unused)
		const dataStart = off + 16
		if (inclLen === 0 || dataStart + inclLen > buf.length || inclLen > 0xffff) {
			truncated++
			break // a corrupt length means the rest is unreliable
		}
		records.push({ tsSec, tsUsec, data: buf.subarray(dataStart, dataStart + inclLen) })
		off = dataStart + inclLen
	}

	return { linkType, nanos, records, truncated }
}
