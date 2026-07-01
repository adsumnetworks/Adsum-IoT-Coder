// Types for the over-the-air BLE sniffer decode rail (nRF Sniffer → PCAP → structured events).
// Mirrors the HCI rail's shapes (hciTypes.ts) so a future viewer / the agent consume both the same way.

export interface SnifferField {
	name: string
	value: string
	isError?: boolean
}

/** One decoded over-the-air BLE packet (Nordic meta header + BLE link-layer PDU). */
export interface SnifferEntry {
	frameNo: number
	/** Sniffer timestamp in ms (from the firmware's µs timestamp). Absolute; format() shows it relative. */
	tsMs?: number
	/** RF channel index 0–39 (37/38/39 = primary advertising). */
	channel: number
	/** Signal strength in dBm (negative). */
	rssiDbm: number
	/** "1M" | "2M" | "Coded" | "?" */
	phy: string
	/** Link-layer CRC verdict from the sniffer meta header. */
	crcOk: boolean
	/** Human PDU name, e.g. "ADV_IND", "CONNECT_IND", "LL_TERMINATE_IND", "LL Data". */
	pduType: string
	summary: string
	fields?: SnifferField[]
	/** Declared PDU payload length in bytes (from the LL header's length field — Wireshark's "Length"). */
	pduLen: number
	/** Coarse, honest protocol label — link-layer only, never ATT/L2CAP/SMP (that's Wireshark's job). */
	proto: "ADV" | "LL-CTRL" | "DATA" | "LL(empty)" | "LL"
	/** First bytes of the BLE LL PDU as hex (capped); full bytes live in the raw .pcap. */
	payloadHex: string
}

export interface SnifferParseResult {
	entries: SnifferEntry[]
	totalFrames: number
	parseErrors: number
	/** Span between first and last frame timestamps, ms. */
	durationMs?: number
	/** PCAP link-layer type seen in the file header (expect 272 = LINKTYPE_NORDIC_BLE). */
	linkType?: number
}
