export type HciPacketType = "CMD" | "EVT" | "ACL_TX" | "ACL_RX" | "SYS" | "MON" | "INDEX" | "UNKNOWN"

export interface HciDecodedField {
	name: string
	value: string
	isError?: boolean
}

export interface HciDecodedDetail {
	fields: HciDecodedField[]
}

export interface HciEntry {
	frameNo: number
	elapsedMs?: number
	type: HciPacketType
	code: string
	summary: string
	payloadHex: string
	payloadLen: number
	/** Present only when the parser produced a per-field decode (e.g. EVT 0x0e). Drives the ▶ expand arrow. */
	decoded?: HciDecodedDetail
}

export interface HciParseResult {
	entries: HciEntry[]
	totalFrames: number
	parseErrors: number
	durationMs?: number
}
