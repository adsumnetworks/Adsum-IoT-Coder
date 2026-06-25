// Renders decoded over-the-air sniffer frames as human- AND agent-readable text (the agent-first half:
// the same structured decode a viewer would paint is written to a plain `.sniffer.log`). Mirrors the
// HCI format so the two BLE layers read the same way.

import { parseNordicBle } from "./nordicBleParser"
import { LINKTYPE_NORDIC_BLE, readPcap } from "./pcapReader"
import type { SnifferEntry, SnifferParseResult } from "./snifferTypes"

/** Relative time from the first frame (ms) → `SS.mmm` / `MM:SS.mmm`. */
function relTime(ms: number | undefined, base: number | undefined): string {
	if (ms === undefined || base === undefined) {
		return "   --.---"
	}
	const t = Math.max(0, ms - base)
	const m = Math.floor(t / 60_000)
	const s = Math.floor((t % 60_000) / 1_000)
	const msec = Math.floor(t % 1_000)
	const p = (n: number, w = 2) => String(n).padStart(w, "0")
	return m > 0 ? `${p(m)}:${p(s)}.${p(msec, 3)}` : `${p(s)}.${p(msec, 3)}`
}

export function formatSniffer(result: SnifferParseResult): string {
	const lines: string[] = []
	const base = result.entries[0]?.tsMs
	lines.push("# BLE over-the-air sniffer decode (nRF Sniffer, what actually transmitted between devices)")
	lines.push(
		`# ${result.totalFrames} frames · ${result.parseErrors} undecoded` +
			(result.durationMs !== undefined ? ` · span ${Math.round(result.durationMs)} ms` : ""),
	)
	if (result.linkType !== undefined && result.linkType !== LINKTYPE_NORDIC_BLE) {
		lines.push(`# ⚠ unexpected PCAP link type ${result.linkType} (expected ${LINKTYPE_NORDIC_BLE} = nRF Sniffer)`)
	}
	lines.push("# This is the AIR layer: advertising packets, CONNECT_IND, and link-layer control/data PDUs.")
	lines.push("# Columns:  #frame  time(rel)  ch  rssi   phy   crc   summary")
	lines.push("#")

	for (const e of result.entries) {
		const ch = `ch${String(e.channel).padStart(2)}`
		const rssi = `${e.rssiDbm}`.padStart(4)
		const crc = e.crcOk ? "ok " : "BAD"
		const head = `#${String(e.frameNo).padStart(5)}  ${relTime(e.tsMs, base)}  ${ch}  ${rssi}dBm ${e.phy.padEnd(5)} ${crc}  ${e.summary}`
		lines.push(head)
		if (e.fields?.length) {
			for (const f of e.fields) {
				lines.push(`           ${f.isError ? "✗ " : "  "}${f.name}: ${f.value}`)
			}
		}
		if (e.payloadHex) {
			lines.push(`           payload: ${e.payloadHex}`)
		}
	}

	if (result.entries.length === 0) {
		lines.push("# (no BLE packets decoded — the dongle may not have seen traffic; check it followed the right device)")
	}
	return `${lines.join("\n")}\n`
}

/**
 * Full rail in one call: PCAP buffer → readable text. Returns the text and the parse result.
 * If the buffer isn't a classic PCAP we can read, returns a clear note instead of throwing.
 */
export function decodeSnifferPcap(buf: Buffer): { text: string; result: SnifferParseResult } {
	const pcap = readPcap(buf)
	if (!pcap) {
		const result: SnifferParseResult = { entries: [], totalFrames: 0, parseErrors: 0 }
		return {
			text: "# BLE sniffer decode — could not read the PCAP (not a classic .pcap, or pcapng). Open it in Wireshark.\n",
			result,
		}
	}
	const result = parseNordicBle(
		pcap.records.map((r) => r.data),
		pcap.linkType,
	)
	return { text: formatSniffer(result), result }
}

export type { SnifferEntry, SnifferParseResult }
