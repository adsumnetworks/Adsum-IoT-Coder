// Renders decoded HCI frames (from parseHci) as human- AND agent-readable text.
//
// This is the agent-first half of HCI observability: the same structured decode that a viewer would
// paint as a table is written to a plain `.hci.log` the developer can open to brainstorm AND the agent
// can `read_file` to analyze. No UI. Format mirrors BlueZ `btmon` so it's familiar to BLE developers.

import type { HciEntry, HciParseResult } from "./hciTypes"

/** Elapsed device uptime (ms from boot) → `HH:MM:SS.mmm`. */
function elapsed(ms: number | undefined): string {
	if (ms === undefined) {
		return "     --.---"
	}
	const total = Math.floor(ms)
	const h = Math.floor(total / 3_600_000)
	const m = Math.floor((total % 3_600_000) / 60_000)
	const s = Math.floor((total % 60_000) / 1_000)
	const msec = total % 1_000
	const p = (n: number, w = 2) => String(n).padStart(w, "0")
	return `${p(h)}:${p(m)}:${p(s)}.${p(msec, 3)}`
}

// Direction hint per packet type — the value of HCI is seeing WHO said WHAT to WHOM.
function arrow(type: HciEntry["type"]): string {
	switch (type) {
		case "CMD":
			return "host → ctrl " // command issued by the host stack
		case "EVT":
			return "ctrl → host " // event/response from the controller
		case "ACL_TX":
			return "host → ctrl " // outbound data
		case "ACL_RX":
			return "ctrl → host " // inbound data
		case "MON":
			return "app log    " // Zephyr LOG_* line interleaved in the monitor stream
		default:
			return "monitor    " // SYS / INDEX bookkeeping
	}
}

/**
 * Format a parsed HCI capture as text. Header explains the layers so the reader (human or agent) can
 * interpret the trace without prior btmon knowledge; one line per frame; decoded fields indented.
 */
export function formatHci(result: HciParseResult): string {
	const lines: string[] = []
	lines.push("# HCI Monitor decode (host ↔ controller traffic, from CONFIG_BT_DEBUG_MONITOR_RTT)")
	lines.push(
		`# ${result.totalFrames} frames · ${result.parseErrors} parse error(s)` +
			(result.durationMs !== undefined ? ` · span ${Math.round(result.durationMs)} ms` : ""),
	)
	lines.push("# Layers: CMD host→ctrl command · EVT ctrl→host event · ACL data · MON app log · SYS/INDEX monitor meta")
	lines.push("# Columns:  #frame  time(uptime)  direction  TYPE  code  summary")
	lines.push("#")

	for (const e of result.entries) {
		const head = `#${String(e.frameNo).padStart(5)}  ${elapsed(e.elapsedMs)}  ${arrow(e.type)} ${e.type.padEnd(6)} ${e.code.padEnd(10)} ${e.summary}`
		lines.push(head)
		if (e.decoded?.fields?.length) {
			for (const f of e.decoded.fields) {
				lines.push(`         ${f.isError ? "✗ " : "  "}${f.name}: ${f.value}`)
			}
		}
		// payloadHex is already capped to 16 bytes + "…" by the parser (payloadToHex); full bytes live in .btmon.
		if (e.payloadHex) {
			lines.push(`           payload: ${e.payloadHex}`)
		}
	}

	if (result.entries.length === 0) {
		lines.push("# (no HCI frames decoded — capture may be empty or the monitor was not enabled)")
	}
	return `${lines.join("\n")}\n`
}
