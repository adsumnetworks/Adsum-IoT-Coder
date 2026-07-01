// Renders decoded over-the-air sniffer frames as human- AND agent-readable text (the agent-first half:
// the same structured decode a viewer would paint is written to a plain `.sniffer.log`). Mirrors the
// HCI format so the two BLE layers read the same way. Styled after Wireshark's nRF-Sniffer packet list
// (No./Time/Proto/Length/Info) so an expert feels at home, with a beginner legend above it.

import { parseNordicBle } from "./nordicBleParser"
import { LINKTYPE_NORDIC_BLE, readPcap } from "./pcapReader"
import type { SnifferEntry, SnifferParseResult } from "./snifferTypes"

/** Cap on rendered lifecycle events in the mermaid footer — keeps it readable for long captures. */
const MERMAID_MAX_EVENTS = 40

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

/** Time since the previous frame (ms) — ≈ the connection interval once a connection is established. */
function fmtDelta(curr: number | undefined, prev: number | undefined): string {
	if (curr === undefined || prev === undefined) {
		return "  --.-"
	}
	return (curr - prev).toFixed(1).padStart(6)
}

/** One-line beginner annotation for the packets that mark a lifecycle transition. Returns undefined for routine frames. */
function lifecycleNote(e: SnifferEntry): string | undefined {
	switch (e.pduType) {
		case "CONNECT_IND": {
			const initA = e.fields?.find((f) => f.name === "Initiator")?.value
			const advA = e.fields?.find((f) => f.name === "Advertiser")?.value
			return `connection starts${initA && advA ? ` (${initA} → ${advA})` : ""}`
		}
		case "LL_PHY_UPDATE_IND":
			return "PHY switch requested"
		case "LL_CONNECTION_UPDATE_IND":
			return "connection interval/timing changing"
		case "LL_TERMINATE_IND": {
			const reason = e.fields?.find((f) => f.name === "Reason")?.value
			return `connection ends${reason ? ` — reason: ${reason}` : ""}`
		}
		default:
			return undefined
	}
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
	lines.push("# We decode the link layer only — never ATT/L2CAP/SMP. Open the .pcap in Wireshark for that depth.")
	lines.push("#")
	lines.push("# Legend (beginner):")
	lines.push("#   Δt(ms) = time since the previous frame (≈ the connection interval, once connected)")
	lines.push("#   Ch     = RF channel index — 37/38/39 are the 3 advertising channels, 0-36 are data channels")
	lines.push("#   Proto  = ADV (advertising) · LL-CTRL (connection control) · DATA (payload) · LL(empty) (keep-alive, no data)")
	lines.push("#   CRC    = ok (frame verified) or BAD (radio noise/collision — ignore that frame's content)")
	lines.push("#")
	lines.push("# Wireshark bridge (expert) — open the .pcap next to this file and try:")
	lines.push("#   btle                            all BLE link-layer frames")
	lines.push("#   !(btle.data_header.length==0)  hide empty keep-alive PDUs")
	lines.push("#   btle.advertising_address        filter by device address")
	lines.push("#   nordic_ble.channel == 37        filter by RF channel")
	lines.push("#")
	lines.push("# Columns:  No.    Time(rel)    Δt(ms)   Ch     RSSI    PHY    Proto      Len   CRC  Info")
	lines.push("#")

	let prevTs: number | undefined
	for (const e of result.entries) {
		const no = `#${String(e.frameNo).padStart(5)}`
		const time = relTime(e.tsMs, base)
		const dt = fmtDelta(e.tsMs, prevTs)
		const ch = `ch${String(e.channel).padStart(2)}`
		const rssi = `${e.rssiDbm}`.padStart(4)
		const phy = e.phy.padEnd(5)
		const proto = e.proto.padEnd(9)
		const len = `${e.pduLen}B`.padStart(5)
		const crc = e.crcOk ? "ok " : "BAD"
		const note = lifecycleNote(e)
		const head = `${no}  ${time}  ${dt}  ${ch}  ${rssi}dBm ${phy} ${proto} ${len} ${crc}  ${e.summary}${note ? `  ← ${note}` : ""}`
		lines.push(head)
		if (e.fields?.length) {
			for (const f of e.fields) {
				lines.push(`           ${f.isError ? "✗ " : "  "}${f.name}: ${f.value}`)
			}
		}
		if (e.payloadHex) {
			lines.push(`           payload: ${e.payloadHex}`)
		}
		prevTs = e.tsMs
	}

	if (result.entries.length === 0) {
		lines.push("# (no BLE packets decoded — the dongle may not have seen traffic; check it followed the right device)")
	}

	const mermaid = buildSnifferMermaid(result.entries)
	if (mermaid) {
		lines.push("#")
		lines.push("# --- suggested chat sequence diagram (mermaid) ---")
		lines.push("# Lift the lines below (strip the leading '# ') into a ```mermaid fence when presenting in chat.")
		for (const l of mermaid.split("\n")) {
			lines.push(`# ${l}`)
		}
	}
	return `${lines.join("\n")}\n`
}

/**
 * Deterministic mermaid `sequenceDiagram` skeleton built ONLY from decoded packets — never invented.
 * Two lifelines (Central/Peripheral), lifecycle events as arrows, runs of empty/data PDUs collapsed
 * into one `Note over` so the diagram stays readable. Bounded to MERMAID_MAX_EVENTS lifecycle arrows.
 * The agent refines labels/notes on top of this skeleton (see analyze-sniffer.md) — it never invents
 * packets that aren't here.
 */
export function buildSnifferMermaid(entries: SnifferEntry[]): string | undefined {
	if (entries.length === 0) {
		return undefined
	}

	let centralAddr: string | undefined
	let peripheralAddr: string | undefined
	for (const e of entries) {
		if (e.pduType === "CONNECT_IND") {
			centralAddr = e.fields?.find((f) => f.name === "Initiator")?.value
			peripheralAddr = e.fields?.find((f) => f.name === "Advertiser")?.value
			break
		}
	}
	if (!peripheralAddr) {
		for (const e of entries) {
			const advA = e.fields?.find((f) => f.name === "Advertiser")?.value
			if (advA) {
				peripheralAddr = advA
				break
			}
		}
	}

	const lines: string[] = ["sequenceDiagram"]
	lines.push(`    participant C as Central${centralAddr ? ` (${centralAddr})` : ""}`)
	lines.push(`    participant P as Peripheral${peripheralAddr ? ` (${peripheralAddr})` : ""}`)

	let runLen = 0
	let runEmpty = 0
	let eventCount = 0
	let truncated = false

	const flushRun = () => {
		if (runLen === 0) {
			return
		}
		if (runEmpty === runLen) {
			lines.push(`    Note over C,P: ${runLen} empty keep-alive PDU${runLen > 1 ? "s" : ""}`)
		} else if (runEmpty === 0) {
			lines.push(
				`    Note over C,P: ${runLen} data PDU${runLen > 1 ? "s" : ""} (GATT traffic — see .pcap in Wireshark for ATT/L2CAP detail)`,
			)
		} else {
			lines.push(`    Note over C,P: ${runLen} connection-event PDUs (${runEmpty} empty keep-alive)`)
		}
		runLen = 0
		runEmpty = 0
	}

	for (const e of entries) {
		if (truncated) {
			break
		}
		const collapsible = e.proto === "DATA" || e.proto === "LL(empty)"
		if (collapsible) {
			runLen++
			if (e.proto === "LL(empty)") {
				runEmpty++
			}
			continue
		}
		flushRun()
		if (eventCount >= MERMAID_MAX_EVENTS) {
			truncated = true
			break
		}
		switch (e.pduType) {
			case "ADV_IND":
			case "ADV_NONCONN_IND":
			case "ADV_SCAN_IND":
			case "ADV_DIRECT_IND":
				lines.push(`    P->>C: ${e.pduType}`)
				eventCount++
				break
			case "SCAN_REQ":
				lines.push("    C->>P: SCAN_REQ")
				eventCount++
				break
			case "SCAN_RSP":
				lines.push("    P-->>C: SCAN_RSP")
				eventCount++
				break
			case "CONNECT_IND":
				lines.push("    C->>P: CONNECT_IND")
				eventCount++
				break
			case "LL_TERMINATE_IND": {
				const reason = e.fields?.find((f) => f.name === "Reason")?.value ?? "unknown"
				lines.push(`    C--xP: LL_TERMINATE_IND (${reason})`)
				eventCount++
				break
			}
			default:
				if (e.proto === "LL-CTRL") {
					lines.push(`    C->>P: ${e.pduType}`)
					eventCount++
				}
		}
	}
	flushRun()
	if (truncated) {
		lines.push("    Note over C,P: (additional lifecycle events truncated — see .pcap in Wireshark for the full sequence)")
	}
	return lines.join("\n")
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
