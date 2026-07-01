// Renders decoded HCI frames (from parseHci) as human- AND agent-readable text.
//
// This is the agent-first half of HCI observability: the same structured decode that a viewer would
// paint as a table is written to a plain `.hci.log` the developer can open to brainstorm AND the agent
// can `read_file` to analyze. No UI. Format mirrors BlueZ `btmon` so it's familiar to BLE developers.

import type { HciEntry, HciParseResult } from "./hciTypes"

/** Cap on rendered lifecycle events in the mermaid footer — keeps it readable for long captures. */
const MERMAID_MAX_EVENTS = 40

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

	const mermaid = buildHciMermaid(result.entries)
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
 * Deterministic mermaid `sequenceDiagram` skeleton built ONLY from decoded HCI frames — never invented.
 * Two lifelines (Host/Controller): every CMD/EVT is the lifecycle signal (the whole point of HCI is
 * host↔controller correlation, so none are filtered), ACL data runs collapse into one `Note over` so the
 * diagram stays readable, and MON/SYS/INDEX bookkeeping is skipped (it isn't a host↔controller exchange).
 * Bounded to MERMAID_MAX_EVENTS arrows. Mirrors `buildSnifferMermaid` so both BLE layers read the same way.
 * The agent refines labels/notes on top of this skeleton (see analyze-hci.md) — it never invents frames
 * that aren't here.
 */
export function buildHciMermaid(entries: HciEntry[]): string | undefined {
	if (entries.length === 0) {
		return undefined
	}

	const lines: string[] = ["sequenceDiagram"]
	lines.push("    participant H as Host")
	lines.push("    participant Ctrl as Controller")

	let runLen = 0
	let eventCount = 0
	let truncated = false
	let emitted = false // any arrow or Note actually rendered? (a MON/SYS/INDEX-only capture emits none)

	const flushRun = () => {
		if (runLen === 0) {
			return
		}
		lines.push(
			`    Note over H,Ctrl: ${runLen} ACL data packet${runLen > 1 ? "s" : ""} (GATT traffic — see .btmon in Wireshark for ATT/L2CAP detail)`,
		)
		runLen = 0
		emitted = true
	}

	for (const e of entries) {
		if (truncated) {
			break
		}
		if (e.type === "ACL_TX" || e.type === "ACL_RX") {
			runLen++
			continue
		}
		if (e.type === "MON" || e.type === "SYS" || e.type === "INDEX" || e.type === "UNKNOWN") {
			continue
		}
		flushRun()
		if (eventCount >= MERMAID_MAX_EVENTS) {
			truncated = true
			break
		}
		if (e.type === "CMD") {
			lines.push(`    H->>Ctrl: ${e.summary.replace(/^TX CMD /, "")}`)
			eventCount++
			emitted = true
		} else if (e.type === "EVT") {
			const arrowOp = e.summary.includes("Disconnection Complete") ? "--x" : "-->>"
			lines.push(`    Ctrl${arrowOp}H: ${e.summary.replace(/^RX EVT /, "")}`)
			eventCount++
			emitted = true
		}
	}
	flushRun()
	if (truncated) {
		lines.push(
			"    Note over H,Ctrl: (additional lifecycle events truncated — see .btmon in Wireshark for the full sequence)",
		)
	}
	// A capture of only MON/SYS/INDEX bookkeeping renders no arrows or notes — return nothing rather than
	// a header-only `sequenceDiagram` skeleton (which shows up as an empty/broken diagram in chat).
	if (!emitted) {
		return undefined
	}
	return lines.join("\n")
}
