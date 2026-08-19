/**
 * nRF91 modem trace — capture, decode, and EXPLAIN.
 *
 * The modem core keeps its own view of the network, and it is the only place that says WHY an attach
 * failed. Getting at it is a four-step pipeline that the agent reinvented by hand, badly, in a real
 * session (2026-08-18): `nrfutil install trace` after hitting "Subcommand nrfutil-trace.exe not found",
 * a PowerShell Start-Process capture, reading a 4.4 MB binary as Latin1 text, and a hand-written pcapng
 * parser whose output was mojibake (`ATND`, `+XD °á`). The raw byte scrape it fell back to DID work —
 * that is the approach used here, deliberately.
 *
 *   npx ts-node --transpile-only -P tsconfig.unit-test.json scripts/modem-trace.ts --decode <trace.bin>
 *   npx ts-node ... scripts/modem-trace.ts --capture --port COM5 --seconds 60 --out logs/
 *
 * The last step is the point. A pcapng is not an answer; "the network refused your SIM, EMM cause 15"
 * is. The pcapng is still written, for Wireshark, when someone wants the full packet detail.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

// ── the modem's vocabulary, in plain language ───────────────────────────────────
// Sources: Nordic nRF91x1 AT command reference (+CEREG / +CFUN / %MDMEV / +CSCON) and 3GPP TS 24.301
// Annex A for the EMM cause values. These are the codes that decide "firmware bug" vs "network fact".

/** `+CEREG: <n>,<stat>` — the single most useful line in any cellular log. */
const CEREG: Record<string, { short: string; plain: string; ok: boolean }> = {
	"0": { short: "not registered, not searching", plain: "Modem idle. Usually CFUN is not 1.", ok: false },
	"1": { short: "registered (home)", plain: "Attached to the home network.", ok: true },
	"2": { short: "searching", plain: "Looking for a network. Normal for ~30 s; persisting means no usable network.", ok: false },
	"3": { short: "registration DENIED", plain: "A network answered and refused. See the EMM cause below.", ok: false },
	"4": { short: "unknown / out of coverage", plain: "No usable signal.", ok: false },
	"5": { short: "registered (roaming)", plain: "Attached via a roaming partner. Success.", ok: true },
	"90": { short: "SIM (UICC) failure", plain: "The modem cannot read a SIM at all. Missing, dead, or not seated.", ok: false },
	"91": {
		short: "no cell for the selected mode",
		plain: "Coverage exists but not in the mode %XSYSTEMMODE selected.",
		ok: false,
	},
}

/** 3GPP TS 24.301 Annex A — the network's own reason for refusing. */
const EMM_CAUSE: Record<string, string> = {
	"3": "Illegal UE — the network rejected this identity outright",
	"6": "Illegal ME — the equipment is barred",
	"7": "EPS services not allowed — the subscription does not permit LTE data",
	"8": "EPS and non-EPS services not allowed",
	"11": "PLMN not allowed — this operator is not permitted for this SIM",
	"12": "Tracking area not allowed",
	"13": "Roaming not allowed in this tracking area — very common on a trial SIM abroad",
	"14": "EPS services not allowed in this PLMN",
	"15": "No suitable cells in tracking area — the SIM may not roam here",
	"22": "Congestion — the network is busy, retry later",
	"35": "Requested service option not subscribed",
}

/** `+CFUN: <mode>` — is the radio even on. */
const CFUN: Record<string, string> = {
	"0": "powered off",
	"1": "full functionality (normal)",
	"4": "flight mode (radio off)",
	"21": "activate LTE, keep GNSS off",
}

/** `%MDMEV:` — Nordic's proprietary modem events. */
const MDMEV: Array<[RegExp, string]> = [
	[/SEARCH STATUS 1/, "started searching for a network"],
	[/SEARCH STATUS 2/, "finished searching and found nothing usable"],
	[/RESET LOOP/, "modem reset loop — it is restarting repeatedly"],
	[/NO IMEI/, "no IMEI — the modem is not provisioned"],
	[/CE-LEVEL/, "coverage-enhancement level changed (weak signal, more repetition)"],
]

// ── plumbing ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`)
	return i !== -1 ? args[i + 1] : undefined
}
const has = (name: string) => args.includes(`--${name}`)
const line = (s = "") => console.log(s)

function nrfutil(): string {
	const local = path.join(os.homedir(), ".nrfutil", "bin", os.platform() === "win32" ? "nrfutil.exe" : "nrfutil")
	return existsSync(local) ? local : "nrfutil"
}

/** `nrfutil trace` ships separately and is missing on a fresh machine — the exact wall the agent hit. */
function ensureTraceCommand(): boolean {
	const probe = spawnSync(nrfutil(), ["trace", "lte", "--help"], { encoding: "utf8", timeout: 60_000 })
	if (probe.status === 0) {
		return true
	}
	line("nrfutil trace is not installed — installing it now (one-off, user-scope)...")
	const inst = spawnSync(nrfutil(), ["install", "trace"], { encoding: "utf8", timeout: 300_000 })
	if (inst.status !== 0) {
		line(`  could not install: ${(inst.stderr || inst.stdout || "").trim().slice(0, 200)}`)
		line("  Run `nrfutil install trace` yourself, then try again.")
		return false
	}
	line("  installed.")
	return true
}

// ── the readable part ───────────────────────────────────────────────────────────

/**
 * Pull the AT dialogue out of a raw trace.
 *
 * Deliberately a byte scrape, not a pcapng parse. The AT stream is ASCII inside the binary, and the
 * hand-rolled pcapng parser in the real session produced mojibake while this approach produced a clean,
 * ordered command list. Simple and it works beats clever and wrong.
 */
function extractAt(buf: Buffer): string[] {
	const text = buf.toString("latin1")
	const out: string[] = []

	// This is scraped from the AT-FILTERED pcapng, never from the raw trace, and that distinction is the
	// whole difference between working and not.
	//
	// nrfutil's own dissector reduces 4.2 MB of framed binary to a ~1.7 KB file containing only AT
	// payloads. Scraping THAT gives clean commands. Scraping the raw trace — the obvious approach, and my
	// first two attempts — walks across the framing and returns fragments: `ATD`, `+PAs`, `%RZD`. Same
	// mojibake the hand-rolled parser produced in the real session.
	const runs = text.match(/[ -~]{3,}/g) ?? []

	for (const run of runs) {
		const s = run.trim()
		if (!s || s.length > 160) {
			continue
		}
		const looksLikeAt = s.startsWith("AT") || s.startsWith("+") || s.startsWith("%") || s === "OK" || s === "ERROR"
		if (!looksLikeAt) {
			continue
		}
		if (out[out.length - 1] === s) {
			continue // collapse identical polling repeats
		}
		out.push(s)
	}
	return out
}

/** Turn the AT dialogue into the answer the developer actually wants. */
function explain(at: string[]): string[] {
	const notes: string[] = []
	const push = (s: string) => notes.push(s)

	// Registration is the headline.
	const cereg = at.filter((l) => l.startsWith("+CEREG:"))
	if (cereg.length) {
		const states = cereg.map((l) =>
			l
				.replace(/^\+CEREG:\s*/, "")
				.split(",")
				.map((x) => x.trim()),
		)
		// Read <stat>: it is field 2 for an unsolicited +CEREG: <n>,<stat>, field 1 for a bare notification.
		const stats = states.map((f) => (f.length > 1 ? f[1] : f[0])).filter(Boolean)
		const final = stats[stats.length - 1]
		const info = CEREG[final]
		push(`Registration ended at +CEREG stat ${final} — ${info ? info.short : "unrecognised"}`)
		if (info) {
			push(`  ${info.plain}`)
		}
		const journey = [...new Set(stats)].join(" -> ")
		if (stats.length > 1) {
			push(`  path through the attach: ${journey}`)
		}
	} else {
		// AT+CEREG=5 is the SUBSCRIBE; +CEREG: is the answer. Saying "never subscribed" when the
		// subscribe is right there in the timeline is the kind of wrong that destroys trust in a tool.
		const subscribed = at.some((l) => l.startsWith("AT+CEREG="))
		push(
			subscribed
				? "Subscribed to registration status (AT+CEREG=), but NO +CEREG answer arrived in this capture — " +
						"the modem never reported a registration state. Usually the capture ended during the search."
				: "No +CEREG traffic at all — the app never subscribed with AT+CEREG=5, so registration is invisible.",
		)
	}

	// Why a refusal happened.
	for (const l of at) {
		const m = l.match(/\+CEER|\+EMM|cause[^0-9]{0,6}(\d{1,3})/i)
		if (m?.[1] && EMM_CAUSE[m[1]]) {
			push(`Network reject cause ${m[1]}: ${EMM_CAUSE[m[1]]}`)
		}
	}

	// SIM.
	if (at.some((l) => /UICC|\+CEREG:\s*(?:\d,)?90/.test(l))) {
		push("SIM: the modem reported a UICC failure — it could not read a card at all.")
	} else if (at.some((l) => l.startsWith("%XICCID"))) {
		push("SIM: an ICCID was read, so the card is present and readable.")
	}

	// Radio mode and what was asked of it.
	const sysmode = at.find((l) => l.startsWith("AT%XSYSTEMMODE="))
	if (sysmode) {
		const f = sysmode.split("=")[1]?.split(",") ?? []
		const on = [f[0] === "1" && "LTE-M", f[1] === "1" && "NB-IoT", f[2] === "1" && "GNSS"].filter(Boolean)
		push(`Radio modes enabled: ${on.length ? on.join(" + ") : "none"} (%XSYSTEMMODE ${f.join(",")})`)
		if (on.length === 1 && on[0] !== "GNSS") {
			push(`  Only one access technology is enabled. If the SIM needs the other, it can never attach.`)
		}
	}
	const cfun = at.filter((l) => l.startsWith("AT+CFUN=")).pop()
	if (cfun) {
		const mode = cfun.split("=")[1]?.trim()
		push(`Modem functional mode set to ${mode} — ${CFUN[mode] ?? "see the AT reference"}`)
	}

	// Nordic modem events.
	for (const l of at) {
		if (!l.startsWith("%MDMEV")) {
			continue
		}
		for (const [re, meaning] of MDMEV) {
			if (re.test(l)) {
				push(`Modem event: ${meaning}  (${l})`)
			}
		}
	}

	if (at.some((l) => l === "ERROR")) {
		push("At least one AT command returned ERROR — check the command just before it in the timeline.")
	}
	return notes
}

// ── run ─────────────────────────────────────────────────────────────────────────

function decode(binPath: string, outDir: string): number {
	if (!existsSync(binPath)) {
		line(`No trace at ${binPath}`)
		return 1
	}
	const buf = readFileSync(binPath)
	line(`Trace: ${binPath}  (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
	line()

	// pcapng for Wireshark — best effort, never fatal. The readable output below is the deliverable.
	const pcap = path.join(outDir, path.basename(binPath).replace(/\.bin$/, "") + ".pcapng")
	if (ensureTraceCommand()) {
		const mfw = flag("mfw")
		const a = ["trace", "lte", "--input-file", binPath, "--output-pcapng", pcap]
		if (mfw) {
			// Autodetect can pick the wrong trace database; AT+CGMR tells you which firmware is running.
			a.push("--mfw-revision-id", mfw)
		}
		const r = spawnSync(nrfutil(), a, { encoding: "utf8", timeout: 300_000 })
		line(r.status === 0 ? `Wireshark file: ${pcap}` : `pcapng decode failed (readable output below is unaffected)`)
	}

	// Second pass: an AT-ONLY pcapng. Small, and the only reliable source of readable AT text.
	const atPcap = path.join(outDir, "modem-at.pcapng")
	let at: string[] = []
	const filt = spawnSync(
		nrfutil(),
		["trace", "lte", "--input-file", binPath, "--output-pcapng", atPcap, "--pcapng-dissector-filter", "at"],
		{ encoding: "utf8", timeout: 300_000 },
	)
	if (filt.status === 0 && existsSync(atPcap)) {
		at = extractAt(readFileSync(atPcap))
	} else {
		line("could not produce the AT-filtered view; falling back to the raw trace (results may be noisy)")
		at = extractAt(buf)
	}

	const atFile = path.join(outDir, "modem-at-timeline.txt")
	writeFileSync(atFile, at.join("\n") + "\n")

	line()
	line("=".repeat(72))
	line("WHAT THE MODEM DID")
	line("=".repeat(72))
	line(`${at.length} AT lines recovered -> ${atFile}`)
	line()
	for (const l of at.slice(0, 40)) {
		line(`  ${l}`)
	}
	if (at.length > 40) {
		line(`  ... ${at.length - 40} more in the file above`)
	}

	line()
	line("=".repeat(72))
	line("WHAT IT MEANS")
	line("=".repeat(72))
	const notes = explain(at)
	for (const n of notes) {
		line(`  ${n}`)
	}
	line()
	line("  Open the .pcapng in Wireshark for the full NAS/RRC packet detail.")
	return 0
}

function capture(port: string, seconds: number, outDir: string): number {
	if (!ensureTraceCommand()) {
		return 1
	}
	const raw = path.join(outDir, `modem_trace_${Date.now()}.bin`)
	line(`Capturing ${seconds}s from ${port} -> ${raw}`)
	line("(reset the board now if you want the boot and attach in the capture)")
	const r = spawnSync(nrfutil(), ["trace", "lte", "--input-serialport", port, "--output-raw", raw], {
		encoding: "utf8",
		timeout: seconds * 1000 + 15_000,
	})
	if (!existsSync(raw)) {
		line(`Capture produced nothing: ${(r.stderr || "").trim().slice(0, 200)}`)
		line("Is the trace UART the right port? It is a DIFFERENT port from the application console.")
		return 1
	}
	return decode(raw, outDir)
}

function main(): number {
	const outDir = flag("out") ?? "."
	mkdirSync(outDir, { recursive: true })

	if (has("decode")) {
		return decode(flag("decode") as string, outDir)
	}
	if (has("capture")) {
		const port = flag("port")
		if (!port) {
			line("--capture needs --port COMx")
			return 1
		}
		return capture(port, Number(flag("seconds") ?? 60), outDir)
	}
	line("nRF91 modem trace — capture, decode, explain")
	line()
	line("  --decode <trace.bin> [--out DIR] [--mfw mfw_nrf91x1_2.0.4]")
	line("  --capture --port COM5 [--seconds 60] [--out DIR]")
	line()
	line("The modem is the only thing that knows WHY an attach failed. This turns its")
	line("trace into an answer, and leaves a .pcapng for Wireshark when you want packets.")
	return 0
}

process.exit(main())
