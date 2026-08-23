#!/usr/bin/env node
/**
 * decode-fault — turn a crash dump's addresses into file:line, on nRF and ESP.
 *
 * The mechanical half of the two `decode-fault` procedures: pull the addresses out of the log, pick
 * the right addr2line for the chip's architecture, run it, and print what came back. The judgement
 * half stays in the K-bits — whether this fault is even worth decoding (a stack overflow is not),
 * and what the resolved line means.
 *
 * Three things this exists to stop, all of them observed:
 *   1. Addresses being retyped by hand. A rounded or transposed digit produces a confident wrong
 *      answer, which is worse than no answer.
 *   2. `arm-zephyr-eabi-addr2line: command not found`. The nRF procedure used to claim the terminal's
 *      env puts it on PATH; it does not, unless the command looks like a west/cmake build. So this
 *      resolves the toolchain itself and calls the binary by absolute path.
 *   3. Silence being read as "no fault". A missing toolchain exits 2 with a structured reason. It
 *      never prints nothing and it never guesses a file:line it did not get from addr2line.
 *
 * Zero dependencies, Node built-ins only. `--elf` is required: resolving it means understanding
 * sysbuild image layout and `project_description.json`, which is the agent's job with `list_files`,
 * not a glob's.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const USAGE = `decode-fault --elf <path> [--log <path>] [--platform nrf|esp] [--chip <target>] [--json]

  --elf <path>       REQUIRED. The .elf of the exact build that was flashed.
  --log <path>       The captured log. Reads stdin when omitted.
  --platform         nrf | esp. Inferred from the fault signature when omitted.
  --chip <target>    esp32 | esp32s2 | esp32s3 | esp32c3 | … — picks the Xtensa prefix.
                     Inferred from the log's boot banner when omitted.
  --addr2line <bin>  Override the resolved binary (testing, or an unusual toolchain layout).
  --json             Machine-readable output.`

// ── argv ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const opt = (n, d = null) => {
	const i = argv.indexOf(`--${n}`)
	return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d
}

if (flag("help") || flag("h")) {
	console.log(USAGE)
	process.exit(0)
}

/** Exit 2 is "bad input or missing prerequisite" — distinct from 1, which would be a crash. */
function fail(status, reason, extra = {}) {
	const payload = { status, reason, ...extra }
	if (flag("json")) {
		console.log(JSON.stringify(payload, null, 2))
	} else {
		console.error(`decode-fault: ${reason}`)
		for (const [k, v] of Object.entries(extra)) {
			console.error(`  ${k}: ${Array.isArray(v) ? v.join("\n    ") : v}`)
		}
	}
	process.exit(2)
}

// ── fault signatures ─────────────────────────────────────────────────────────

/**
 * Zephyr prints the faulting PC and LR as labelled registers; ESP prints either an Xtensa
 * `Backtrace:` line of `PC:SP` pairs or, on RISC-V, `MEPC`/`RA` registers. Anchored patterns only:
 * a loose hex match would happily "find" addresses in a memory dump.
 */
const NRF_SIGNATURES = [
	/>>> ZEPHYR FATAL ERROR/,
	/\*{3,}\s*(USAGE|BUS|MPU|HARD)\s+FAULT/i,
	/Faulting instruction address/,
	/FATAL ERROR: SecureFault/,
]
const ESP_SIGNATURES = [
	/Guru Meditation Error/,
	/Backtrace:\s*0x[0-9a-fA-F]+:0x[0-9a-fA-F]+/,
	/\bMEPC\s*:\s*0x[0-9a-fA-F]+/,
	/abort\(\) was called at PC 0x[0-9a-fA-F]+/,
]

/** A stack overflow is a fault the K-bits say NOT to decode — the addresses are meaningless. */
const DO_NOT_DECODE = [
	{ re: /Stack overflow \(context area not valid\)/, why: "stack overflow — the frame is corrupt, so the addresses are not the fault site" },
	{ re: /\*{3,}\s*Stack overflow/i, why: "stack overflow — raise the thread's stack rather than decoding" },
	{ re: /Task watchdog got triggered/, why: "task watchdog — a hang, not an address fault" },
	{ re: /Brownout detector was triggered/, why: "brownout — a power fault, not an address fault" },
]

export function detectPlatform(log) {
	if (ESP_SIGNATURES.some((re) => re.test(log))) {
		return "esp"
	}
	if (NRF_SIGNATURES.some((re) => re.test(log))) {
		return "nrf"
	}
	return null
}

export function refusalFor(log) {
	return DO_NOT_DECODE.find((d) => d.re.test(log))?.why ?? null
}

/**
 * Extract the addresses to decode.
 *
 * Xtensa is the odd one: its `Backtrace:` line is a list of `PC:SP` PAIRS, and addr2line takes the
 * pairs verbatim — splitting on whitespace and dropping the `:SP` half loses the frame walk. RISC-V
 * and ARM pass bare addresses. One code path per shape, deliberately, rather than one generic split.
 */
export function extractAddresses(log, platform) {
	const frames = []
	if (platform === "esp") {
		const bt = /Backtrace:((?:\s*0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)+)/.exec(log)
		if (bt) {
			for (const m of bt[1].matchAll(/0x[0-9a-fA-F]+:0x[0-9a-fA-F]+/g)) {
				frames.push({ arg: m[0], label: "backtrace" })
			}
			return { frames, syntax: "xtensa-pairs" }
		}
		const mepc = /\bMEPC\s*:\s*(0x[0-9a-fA-F]+)/.exec(log)
		const ra = /\bRA\s*:\s*(0x[0-9a-fA-F]+)/.exec(log)
		if (mepc) {
			frames.push({ arg: mepc[1], label: "MEPC (crash PC)" })
		}
		if (ra) {
			frames.push({ arg: ra[1], label: "RA (caller)" })
		}
		if (!frames.length) {
			const abort = /abort\(\) was called at PC (0x[0-9a-fA-F]+)/.exec(log)
			if (abort) {
				frames.push({ arg: abort[1], label: "abort() PC" })
			}
		}
		return { frames, syntax: "riscv-bare" }
	}
	// nRF / Zephyr on ARM
	const pc = /(?:Faulting instruction address \(r15\/pc\)|\bPC)\s*:\s*(0x[0-9a-fA-F]+)/.exec(log)
	const lr = /(?:r14\/lr|\bLR)\s*:\s*(0x[0-9a-fA-F]+)/.exec(log)
	if (pc) {
		frames.push({ arg: pc[1], label: "PC (faulting instruction)" })
	}
	if (lr) {
		frames.push({ arg: lr[1], label: "LR (caller)" })
	}
	return { frames, syntax: "arm-bare" }
}

// ── toolchain ────────────────────────────────────────────────────────────────

/** Chip → addr2line prefix, lifted verbatim from the ESP decode-fault procedure's table. */
export const ESP_ARCH = {
	esp32: "xtensa-esp32-elf",
	esp32s2: "xtensa-esp32s2-elf",
	esp32s3: "xtensa-esp32s3-elf",
	esp32c2: "riscv32-esp-elf",
	esp32c3: "riscv32-esp-elf",
	esp32c5: "riscv32-esp-elf",
	esp32c6: "riscv32-esp-elf",
	esp32c61: "riscv32-esp-elf",
	esp32h2: "riscv32-esp-elf",
	esp32p4: "riscv32-esp-elf",
}

export function chipFromLog(log) {
	// The IDF boot banner names the chip; "ESP32-S3" and "esp32s3" both appear in the wild.
	const m = /ESP32-?([SCHP]\d+[a-z]?)\b/i.exec(log) || /\besp32(s\d|c\d+|h\d|p\d)\b/i.exec(log)
	if (m) {
		return `esp32${m[1].toLowerCase()}`
	}
	return /\bESP32\b/.test(log) ? "esp32" : null
}

function exists(p) {
	try {
		return !!p && existsSync(p)
	} catch {
		return false
	}
}

/** Every place the nRF toolchain's addr2line is known to live, in the order worth trying. */
function nrfCandidates() {
	const searched = []
	const push = (p) => {
		if (p) {
			searched.push(p)
		}
	}
	// 1. The toolchain manager knows exactly where it put things. Ask it rather than guessing.
	for (const nrfutil of ["nrfutil", path.join(process.env.HOME ?? "", ".nrfutil", "bin", "nrfutil")]) {
		try {
			const out = execFileSync(nrfutil, ["toolchain-manager", "list", "--json"], {
				encoding: "utf8",
				timeout: 15000,
				stdio: ["ignore", "pipe", "ignore"],
			})
			for (const m of out.matchAll(/"path"\s*:\s*"([^"]+)"/g)) {
				push(path.join(m[1], "opt", "zephyr-sdk", "arm-zephyr-eabi", "bin", "arm-zephyr-eabi-addr2line"))
			}
		} catch {
			// not installed, or an older nrfutil without --json — fall through to the known layouts
		}
	}
	// 2. The default install locations, newest SDK first.
	for (const base of [
		path.join(process.env.HOME ?? "", "ncs", "toolchains"),
		path.join(process.env.HOME ?? "", ".local", "share", "nrfutil", "toolchains"),
		"/opt/nordic/ncs/toolchains",
	]) {
		try {
			for (const d of readdirSync(base).sort().reverse()) {
				push(path.join(base, d, "opt", "zephyr-sdk", "arm-zephyr-eabi", "bin", "arm-zephyr-eabi-addr2line"))
			}
		} catch {
			// directory absent — normal on a machine that installs the SDK elsewhere
		}
	}
	// 3. A Zephyr SDK installed on its own.
	if (process.env.ZEPHYR_SDK_INSTALL_DIR) {
		push(path.join(process.env.ZEPHYR_SDK_INSTALL_DIR, "arm-zephyr-eabi", "bin", "arm-zephyr-eabi-addr2line"))
	}
	return searched
}

/** Where the IDF puts its cross toolchains. */
function espCandidates(prefix) {
	const searched = []
	const tools = process.env.IDF_TOOLS_PATH || path.join(process.env.HOME ?? "", ".espressif")
	const base = path.join(tools, "tools", `${prefix}-gcc`)
	try {
		for (const ver of readdirSync(base).sort().reverse()) {
			const inner = path.join(base, ver)
			for (const sub of readdirSync(inner)) {
				searched.push(path.join(inner, sub, "bin", `${prefix}-addr2line`))
			}
		}
	} catch {
		// not installed under IDF_TOOLS_PATH — PATH is tried below
	}
	return searched
}

/** Resolve the addr2line binary by ABSOLUTE path, never trusting PATH alone. */
export function resolveAddr2line(platform, chip, override) {
	if (override) {
		return { bin: override, searched: [override], onPath: false }
	}
	const prefix = platform === "esp" ? (ESP_ARCH[chip ?? ""] ?? "riscv32-esp-elf") : "arm-zephyr-eabi"
	const name = `${prefix}-addr2line`
	const searched = platform === "esp" ? espCandidates(prefix) : nrfCandidates()
	for (const c of searched) {
		if (exists(c)) {
			return { bin: c, searched, onPath: false }
		}
	}
	// PATH last: it works inside an already-sourced IDF/NCS shell, and costs nothing to try.
	try {
		execFileSync(name, ["--version"], { stdio: "ignore", timeout: 8000 })
		return { bin: name, searched: [...searched, `${name} (PATH)`], onPath: true }
	} catch {
		return { bin: null, searched: [...searched, `${name} (PATH)`], onPath: false }
	}
}

// ── main ─────────────────────────────────────────────────────────────────────

function readLog() {
	const p = opt("log")
	if (p) {
		if (!exists(p)) {
			fail("log-not-found", `no log at ${p}`)
		}
		return readFileSync(p, "utf8")
	}
	try {
		return readFileSync(0, "utf8")
	} catch {
		return ""
	}
}

function main() {
	const elf = opt("elf")
	if (!elf) {
		fail("elf-required", "--elf is required", {
			why:
				"resolving the .elf means knowing the sysbuild image layout (nRF) or reading app_elf from " +
				"build/project_description.json (ESP) — a glob picks the wrong image in a multi-image build.",
			usage: USAGE,
		})
	}
	if (!exists(elf)) {
		fail("elf-not-found", `no .elf at ${elf}`)
	}
	try {
		if (statSync(elf).size === 0) {
			fail("elf-not-found", `${elf} is empty`)
		}
	} catch {
		fail("elf-not-found", `${elf} could not be read`)
	}

	const log = readLog()
	if (!log.trim()) {
		fail("no-log", "no log on stdin and no --log given")
	}

	const refusal = refusalFor(log)
	if (refusal) {
		const payload = { status: "not-an-address-fault", reason: refusal }
		if (flag("json")) {
			console.log(JSON.stringify(payload, null, 2))
		} else {
			console.log(`Not decoding: ${refusal}`)
		}
		process.exit(0)
	}

	const platform = opt("platform") ?? detectPlatform(log)
	if (!platform) {
		const payload = { status: "no-fault-found", reason: "no fault signature in this log" }
		if (flag("json")) {
			console.log(JSON.stringify(payload, null, 2))
		} else {
			console.log("No fault signature in this log — there is nothing to decode.")
		}
		process.exit(0)
	}

	const chip = platform === "esp" ? (opt("chip") ?? chipFromLog(log)) : null
	const { frames, syntax } = extractAddresses(log, platform)
	if (!frames.length) {
		fail("no-addresses", "a fault signature is present but no address could be read from it", {
			platform,
			hint: "the dump may be truncated — capture the whole panic block, not just the banner",
		})
	}

	const { bin, searched } = resolveAddr2line(platform, chip, opt("addr2line"))
	if (!bin) {
		// The honest stop. NEVER print nothing here: silence reads as "no fault", which is the exact
		// misdiagnosis this tool exists to prevent.
		fail("toolchain-not-found", `no addr2line for ${platform}${chip ? ` (${chip})` : ""}`, {
			searched,
			next: "install the SDK toolchain, or pass --addr2line <path> if it lives somewhere unusual",
		})
	}

	const args = ["-pfiaC", "-e", elf, ...frames.map((f) => f.arg)]
	let out
	try {
		out = execFileSync(bin, args, { encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
	} catch (e) {
		fail("addr2line-failed", `addr2line exited non-zero: ${e.message?.split("\n")[0] ?? e}`, {
			binary: bin,
			args: args.join(" "),
		})
	}

	const lines = out.split(/\r?\n/).filter((l) => l.trim())
	const decoded = frames.map((f, i) => ({ address: f.arg, label: f.label, resolved: lines[i] ?? null }))

	if (flag("json")) {
		console.log(JSON.stringify({ status: "ok", platform, chip, syntax, elf, binary: bin, frames: decoded }, null, 2))
		return
	}
	console.log(`Fault decoded — ${platform}${chip ? ` (${chip})` : ""}, ${path.basename(elf)}`)
	for (const d of decoded) {
		console.log(`  ${d.label.padEnd(26)} ${d.address}`)
		console.log(`    ${d.resolved ?? "(addr2line returned nothing for this frame)"}`)
	}
	console.log("\nRead the resolved file:line and show the offending code — the location alone explains nothing.")
}

// Importable for tests; only runs the CLI when invoked directly. `pathToFileURL` rather than a
// `file://` template: every real Adsum checkout lives under "Adsum IoT Coder", and an unencoded
// space makes the comparison silently false — the CLI then exits 0 having done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main()
}
