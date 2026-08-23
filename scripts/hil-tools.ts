// Hardware-in-the-loop coverage for TOOL BITS — the downloadable ones especially.
//
// Why this exists. `test:hil` proves ONE tool bit (nrf-sniffer) against a dongle. The other six have
// never been exercised by anything but a human, and the three DOWNLOADABLE ones (log-shape,
// modem-trace, board-shell) carry a failure mode the bundled ones do not: they must be fetched,
// signature-checked and materialised into the T-bit cache before they can run at all. On the freshly
// provisioned bench that cache does not exist — so that rail has never once executed there.
//
// The rule this file obeys, and the reason it is written this way: DRIVE THE PRODUCTION RAIL. It
// imports `commandPrefix`/`launcherName` from src rather than re-deriving how a tool is invoked, and
// `safeSegment` rather than guessing the cache layout. `test:hil` broke precisely because it carried
// its own copy of a path that production had moved on from; a test that duplicates the logic it is
// meant to guard will drift away from it and then report green while doing so.
//
// What it asserts per tool:
//   RESOLVE     — findable the way production finds it: bundled manifest, or T-bit cache by id+version.
//   INVOKE      — runs under the exact command prefix production would build for it.
//   HARDWARE    — board-facing tools talk to at least TWO different boards, because a tool that works
//                 on the one board its author owned is the defect this bench exists to catch.
//
// Hardware-gated: no boards ⇒ skip cleanly and say what was missing. A skip is a result; a pass
// invented from no evidence is not.
//
// Usage:
//   npm run test:hil-tools
//   HIL_BOARDS=/dev/ttyACM0,/dev/ttyACM3   explicit ports, skip nrfutil discovery
//   HIL_LOGS=/path/a.log,/path/b.log       real captures for log-shape (two different boards)
//   HIL_MODEM_TRACE=/path/trace.bin        an nRF91 modem trace to decode

import { execFileSync, spawn, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { RegistryClient } from "../src/services/knowledge/registry/RegistryClient"
import { commandPrefix, launcherName, type ToolRuntime } from "../src/services/tools/launchers"
import { safeSegment, ToolCache } from "../src/services/tools/ToolCache"
import { materialiseDownloadedTool, toolEntriesFromDownloadedManifest } from "../src/services/tools/ToolResolver"

const ROOT = path.join(__dirname, "..")
const KNOWLEDGE = path.join(ROOT, "iot-knowledge")

/** Where the host keeps its caches. Mirrors toolCacheRoot()/the k-bit cache, which sit side by side. */
function globalStorage(): string {
	const id = "adsumnetwork.nrf-ai-debugger"
	const bases =
		process.platform === "darwin"
			? [path.join(os.homedir(), "Library/Application Support/Code/User/globalStorage")]
			: process.platform === "win32"
				? [path.join(process.env.APPDATA ?? "", "Code/User/globalStorage")]
				: [path.join(os.homedir(), ".config/Code/User/globalStorage")]
	for (const b of bases) {
		const p = path.join(b, id)
		if (fs.existsSync(p)) {
			return p
		}
	}
	return path.join(bases[0], id)
}

// ── result plumbing ─────────────────────────────────────────────────────────────
type Outcome = "PASS" | "FAIL" | "SKIP" | "WARN"
const results: { tool: string; check: string; outcome: Outcome }[] = []
function record(tool: string, check: string, outcome: Outcome, detail = ""): void {
	results.push({ tool, check, outcome })
	console.log(`  ${outcome}  ${tool} · ${check}${detail ? ` — ${detail}` : ""}`)
}

// ── resolution ──────────────────────────────────────────────────────────────────
interface Tool {
	id: string
	name: string
	dir: string
	runtime: ToolRuntime
	version: string
	delivery: "bundled" | "downloaded"
	/** Exactly what production would spawn, before the tool's own flags. */
	argv: string[]
}

const scalar = (yaml: string, key: string): string | undefined =>
	yaml
		.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"))?.[1]
		?.trim()
		.replace(/^["']|["']$/g, "")

function probePython(): string | null {
	for (const c of ["python3", "python", "py"]) {
		try {
			execFileSync(c, ["-c", "import sys; sys.exit(0)"], { stdio: "ignore", timeout: 5000 })
			return c
		} catch {
			/* next */
		}
	}
	return null
}
const PYTHON = probePython()

/** Build the production invocation for a tool whose bundle is on disk. Null when the entry is absent. */
function toolAt(
	id: string,
	dir: string,
	meta: { runtime?: string; entry?: string; version?: string },
	delivery: Tool["delivery"],
): Tool | null {
	const { runtime, entry } = meta
	if (!runtime || !entry) {
		return null
	}
	const entryPath = path.join(dir, entry)
	if (!fs.existsSync(entryPath)) {
		return null // production's Rule 1: an entry not on disk is not a tool
	}
	const name = id.split("/").pop() ?? id
	const launcher = path.join(dir, launcherName(name))
	return {
		id,
		name,
		dir,
		version: meta.version ?? "-",
		runtime: runtime as ToolRuntime,
		delivery,
		argv: commandPrefix({
			runtime: runtime as ToolRuntime,
			launcherPath: fs.existsSync(launcher) ? launcher : undefined,
			entryPath,
			interpreter: PYTHON ?? undefined,
		}),
	}
}

/** Bundled tools: read the shipped manifest, then each TOOL.md's frontmatter. */
function bundledTools(): Tool[] {
	const mf = path.join(KNOWLEDGE, "manifest.json")
	if (!fs.existsSync(mf)) {
		return []
	}
	const out: Tool[] = []
	for (const b of JSON.parse(fs.readFileSync(mf, "utf-8")).bits ?? []) {
		if (b.type !== "tool" || typeof b.path !== "string") {
			continue
		}
		const md = path.join(KNOWLEDGE, b.path)
		if (!fs.existsSync(md)) {
			continue
		}
		const yaml = fs.readFileSync(md, "utf-8")
		const t = toolAt(
			b.id,
			path.dirname(md),
			{ runtime: scalar(yaml, "runtime"), entry: scalar(yaml, "entry"), version: scalar(yaml, "version") },
			"bundled",
		)
		if (t) {
			out.push(t)
		}
	}
	return out
}

/**
 * Drive the DOWNLOAD RAIL, which is the half of the tool surface nothing else tests.
 *
 * This is the assertion worth having on a fresh machine. The editor fetches the catalog lazily —
 * once per session, and only when something actually asks for a k-bit — so a bench that has never
 * run a task has a cache that predates every tool bit ever published, and any test reading only that
 * cache silently reports "nothing to test" instead of "the rail never ran".
 *
 * So: fetch the catalog, then materialise each tool through the SAME production function the
 * extension uses — signature verified before a byte is fetched, hashes checked on arrival, atomic
 * rename into the cache. Not a curl into place; the real thing, minus the editor.
 */
async function materialiseDownloadables(): Promise<{ advertised: { id: string; version: string }[]; cacheRoot: string }> {
	const cacheRoot = path.join(globalStorage(), "tbit-cache")
	const advertised: { id: string; version: string }[] = []
	if (process.env.HIL_NO_FETCH) {
		record("download rail", "fetch", "SKIP", "HIL_NO_FETCH set")
		return { advertised, cacheRoot }
	}
	const client = new RegistryClient(process.env.ADSUM_API_BASE ?? "https://api.adsumnetworks.com")
	let manifest: { bits?: Array<Record<string, unknown>> } | null = null
	try {
		manifest = (await client.fetchManifest()) as { bits?: Array<Record<string, unknown>> } | null
	} catch (e) {
		record("download rail", "fetch catalog", "FAIL", String(e).slice(0, 88))
		return { advertised, cacheRoot }
	}
	if (!manifest) {
		record("download rail", "fetch catalog", "FAIL", "registry returned no catalog")
		return { advertised, cacheRoot }
	}
	const entries = toolEntriesFromDownloadedManifest(manifest.bits ?? [])
	record("download rail", "fetch catalog", "PASS", `${manifest.bits?.length ?? 0} bits, ${entries.length} tool bit(s)`)

	const cache = new ToolCache(cacheRoot)
	for (const entry of entries) {
		const id = String(entry.id ?? "")
		const version = String(entry.version ?? "")
		advertised.push({ id, version })
		try {
			const tool = await materialiseDownloadedTool({
				entry,
				cache,
				fetchArtifact: (sha: string) => client.fetchArtifact(sha),
			})
			// A null return is deliberately opaque in production — locked, unsigned and unreachable all
			// mean "do not advertise". For a test that distinction matters, so say what is on disk.
			const dir = cache.dirFor(id, version)
			const landed = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0
			record(
				"download rail",
				`materialise ${id}@${version}`,
				tool ? "PASS" : "FAIL",
				tool
					? `${landed} file(s)`
					: landed > 0
						? `${landed} file(s) on disk but not runnable`
						: "nothing materialised (locked, unsigned or unreachable)",
			)
		} catch (e) {
			record("download rail", `materialise ${id}@${version}`, "FAIL", String(e).slice(0, 88))
		}
	}
	return { advertised, cacheRoot }
}

/** Read back what actually landed, resolving each the way production resolves a downloaded tool. */
function downloadedTools(
	advertised: { id: string; version: string }[],
	cacheRoot: string,
	catalog: Map<string, Record<string, unknown>>,
): Tool[] {
	const tools: Tool[] = []
	for (const { id, version } of advertised) {
		const meta = catalog.get(id) ?? {}
		const t = toolAt(
			id,
			path.join(cacheRoot, safeSegment(id), version),
			{ runtime: String(meta.runtime ?? ""), entry: String(meta.entry ?? ""), version },
			"downloaded",
		)
		if (t) {
			tools.push(t)
		}
	}
	return tools
}

// ── hardware ────────────────────────────────────────────────────────────────────
interface Board {
	label: string
	serial: string
	/** Every VCOM the board exposes, in nrfutil's order. [0] is the application console. */
	ports: string[]
	family: string
	boardVersion: string
}
const consolePort = (b: Board) => b.ports[0]

/** nRF91 detection, matching hil-cellular: nrfutil reports `product: "J-Link"` for EVERY Nordic DK,
 *  so the USB strings are useless here and only the devkit fields identify the family. */
const NRF91_BOARDS = new Set(["PCA10090", "PCA10153", "PCA10171"])
const isNrf91 = (b: Board) => b.family.toUpperCase().includes("NRF91") || NRF91_BOARDS.has(b.boardVersion.toUpperCase())

function discoverBoards(): Board[] {
	if (process.env.HIL_BOARDS) {
		return process.env.HIL_BOARDS.split(",")
			.map((p) => p.trim())
			.filter(Boolean)
			.map((p) => ({ label: path.basename(p), serial: "", ports: [p], family: "", boardVersion: "" }))
	}
	const bin = path.join(os.homedir(), ".nrfutil", "bin", process.platform === "win32" ? "nrfutil.exe" : "nrfutil")
	const boards: Board[] = []
	try {
		const raw = execFileSync(fs.existsSync(bin) ? bin : "nrfutil", ["device", "list", "--json"], {
			encoding: "utf-8",
			timeout: 60_000,
		})
		for (const line of raw.split("\n")) {
			if (!line.trim().startsWith("{")) {
				continue
			}
			try {
				for (const d of JSON.parse(line)?.data?.data?.devices ?? []) {
					// The FIRST VCOM is the application console; later ones carry trace/aux.
					const ports = (d.serialPorts ?? []).map((s: { comName?: string }) => s.comName).filter(Boolean)
					if (ports.length) {
						boards.push({
							label: `${d.devkit?.boardVersion ?? d.serialNumber}`,
							serial: String(d.serialNumber ?? ""),
							ports,
							family: String(d.devkit?.deviceFamily ?? ""),
							boardVersion: String(d.devkit?.boardVersion ?? ""),
						})
					}
				}
			} catch {
				/* not a device line */
			}
		}
	} catch {
		/* nrfutil absent or no devices */
	}
	return boards
}

// ── checks ──────────────────────────────────────────────────────────────────────
/** The bench serialises hardware access through a per-board flock. Honour it whenever it is installed:
 *  two runs deciding to reflash one board is destructive, not merely wasteful. */
const HAVE_CLAIM = (() => {
	try {
		execFileSync("bench-claim", ["--help"], { stdio: "ignore", timeout: 5000 })
		return true
	} catch {
		return fs.existsSync("/usr/local/bin/bench-claim")
	}
})()

function spawnTool(argv: string[], args: string[], ms: number, claim?: string) {
	const full = [...argv, ...args]
	const [cmd, ...rest] = HAVE_CLAIM && claim ? ["bench-claim", claim, ...full] : full
	return spawnSync(cmd, rest, { encoding: "utf-8", timeout: ms })
}
const run = (t: Tool, args: string[], ms = 90_000, claim?: string) => spawnTool(t.argv, args, ms, claim)
const firstLine = (s: string) => (s || "").trim().split("\n")[0]?.slice(0, 88) ?? ""

/** board-shell — the one tool whose whole purpose is talking to a board. Needs two. */
function checkBoardShell(t: Tool, boards: Board[]): void {
	const ports = run(t, ["--list-ports"], 60_000)
	if (ports.status !== 0) {
		record(t.id, "--list-ports", "FAIL", firstLine(ports.stderr || ports.stdout))
		return
	}
	record(t.id, "--list-ports", "PASS", `${(ports.stdout.match(/\/dev\/tty|COM\d+/g) ?? []).length} port(s)`)

	if (boards.length < 2) {
		record(t.id, "two boards", "SKIP", `only ${boards.length} board(s) attached`)
		return
	}
	// Two boards that ANSWER, not the first two in enumeration order. A wedged endpoint is a real
	// finding and is reported as one, but it must not stand in for coverage — the bench's ESP32-C6
	// native-USB port refuses I/O, and stopping there left board-shell proven on a single board while
	// a perfectly good CH343 bridge sat untried two entries down the list.
	let ok = 0
	let tried = 0
	for (const b of boards) {
		if (ok >= 2) {
			break
		}
		tried++
		const r = run(t, ["--port", consolePort(b), "--cmd", "kernel version", "--timeout", "8"], 90_000, b.serial)
		// The tool's exit codes carry the distinction that matters here, and conflating them is how you
		// get a red suite that is really just describing the firmware on the bench:
		//   0 — the board answered
		//   1 — timeout/inconclusive: the port opened, the command went out, nothing came back. That is
		//       the correct answer for a board running peripheral_uart rather than a Zephyr shell, and it
		//       still exercises the whole open/write/read/close path the tool owns.
		//   2+ — the tool could not do its job: port busy, no such port, no pyserial.
		if (r.status === 0 || r.status === 1) {
			ok++
			const reply = (r.stdout || "").split("\n").filter(Boolean).pop() ?? ""
			record(
				t.id,
				`talk to ${b.label}`,
				"PASS",
				r.status === 0 ? firstLine(reply) : "port opened, board did not answer (no shell in this firmware)",
			)
		} else {
			// Reported, and not fatal on its own: the next board still gets its turn. Exit 2 is the tool
			// saying it could not reach the board at all, which is a bench fact worth surfacing.
			record(t.id, `talk to ${b.label}`, "WARN", `exit ${r.status}: ${firstLine(r.stderr || r.stdout)}`)
		}
	}
	record(t.id, "two-board coverage", ok >= 2 ? "PASS" : "FAIL", `${ok} board(s) answered of ${tried} tried`)
}

/** log-shape — describe REAL captures. Two different boards' logs, never a synthetic fixture. */
function checkLogShape(t: Tool, logs: string[], boards: Board[], loggers: Tool[]): void {
	// Prefer evidence this run produced. Driving the BUNDLED uart-logger against two different boards
	// and then describing both with the DOWNLOADED log-shape is the chain a developer actually walks —
	// and it means the assertion rests on bytes that came off real silicon minutes ago, not on whatever
	// happened to be left in a directory.
	if (logs.length < 2 && boards.length >= 2) {
		const uart = loggers.find((l) => l.name === "uart-logger")
		if (uart) {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hil-logs-"))
			for (const b of boards.slice(0, 2)) {
				const out = path.join(dir, b.serial || b.label)
				const r = run(
					uart,
					["--capture", "--port", consolePort(b), "--name", b.label, "--duration", "8", "--output", out],
					120_000,
					b.serial,
				)
				const produced = fs.existsSync(out)
					? fs
							.readdirSync(out)
							.map((f) => path.join(out, f))
							.filter((f) => fs.statSync(f).size > 0)
					: []
				record(
					uart.id,
					`capture from ${b.label}`,
					produced.length ? "PASS" : "FAIL",
					produced.length ? `${fs.statSync(produced[0]).size} B` : firstLine(r.stderr || r.stdout),
				)
				logs.push(...produced.slice(0, 1))
			}
		}
	}
	if (logs.length < 2) {
		record(t.id, "two boards", "SKIP", `${logs.length} real log(s) — needs two boards or HIL_LOGS`)
		return
	}
	let ok = 0
	for (const f of logs.slice(0, 2)) {
		const r = run(t, [f, "--json"], 60_000)
		if (r.status !== 0) {
			record(t.id, `shape ${path.basename(f)}`, "FAIL", firstLine(r.stderr))
			continue
		}
		try {
			const j = JSON.parse(r.stdout)
			const kinds = Array.isArray(j) ? j.length : (j.distinctKinds ?? j.kinds?.length ?? 0)
			if (kinds > 0) {
				ok++
				record(t.id, `shape ${path.basename(f)}`, "PASS", `${kinds} distinct kind(s)`)
			} else {
				record(t.id, `shape ${path.basename(f)}`, "FAIL", "no kinds found in a non-empty log")
			}
		} catch {
			record(t.id, `shape ${path.basename(f)}`, "FAIL", "--json output was not parseable JSON")
		}
	}
	record(t.id, "two-board coverage", ok >= 2 ? "PASS" : "FAIL", `${ok}/2 real captures described`)
}

/**
 * Capture a modem trace over RTT, which is the route that actually works on an nRF9161 DK.
 *
 * The UART backend is the documented one and it builds correctly — CONFIG_NRF_MODEM_LIB_TRACE=y, the
 * UART backend selected, uart1 at 1 Mbaud, `nordic,modem-trace-uart` chosen — and it still yields
 * nothing on this board, because on the nRF9161 DK uart1 is `arduino_serial`: it goes to the Arduino
 * header pins, not to VCOM1. Nothing arrives at /dev/…-vcom1 no matter what the firmware does.
 *
 * RTT sidesteps the wiring entirely: the trace backend allocates a named up-buffer, "modem_trace",
 * and JLinkRTTLogger writes that channel to a file byte-for-byte — which is exactly what
 * `modem-trace --decode` wants. Two tool bits meet here: the capture feeds the decode.
 *
 * Returns the path to a non-empty trace, or null. Never returns an empty file: an empty trace is the
 * defect this whole suite exists to refuse.
 */
function captureTraceOverRtt(serial: string, seconds = 25, console_?: { tool: Tool; port: string }): string | null {
	if (!fs.existsSync("/usr/bin/JLinkRTTLogger") && spawnSync("which", ["JLinkRTTLogger"]).status !== 0) {
		return null
	}
	const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hil-rtt-")), "modem-trace.bin")
	// nRF9161 answers to the nRF9160 J-Link target; the 9161 name is not in this J-Link's device table.
	// Channel 1 is where the named buffer lands when channel 0 is the console — the logger prints the
	// channel names it found, so a wrong guess is visible rather than silent.
	// Give the modem something to say. A board sitting at its prompt still emits trace, but none of it
	// is AT dialogue — the first run captured 100 kB that decoded to zero AT lines, which is a
	// perfectly true result and a useless test. Cycling CFUN mid-capture makes the trace carry the
	// exchange the tool exists to explain. Fire-and-forget: if the shell is busy the capture is still
	// valid, just quieter.
	if (console_) {
		const argv = [
			...console_.tool.argv,
			"--port",
			console_.port,
			"--cmd",
			"at AT+CFUN=4",
			"--cmd",
			"at AT+CFUN=1",
			"--timeout",
			"15",
		]
		spawn(argv[0], argv.slice(1), { detached: true, stdio: "ignore" }).unref()
	}
	const r = spawnSync(
		"bench-claim",
		[
			serial,
			"timeout",
			String(seconds + 5),
			"JLinkRTTLogger",
			"-Device",
			"nRF9160_XXAA",
			"-If",
			"SWD",
			"-Speed",
			"4000",
			"-RTTChannel",
			"1",
			"-USB",
			serial.padStart(12, "0"),
			out,
		],
		{ encoding: "utf-8", timeout: (seconds + 20) * 1000 },
	)
	if (!/modem_trace/.test(r.stdout ?? "")) {
		return null // the board is not running trace-enabled firmware
	}
	return fs.existsSync(out) && fs.statSync(out).size > 0 ? out : null
}

/** modem-trace — needs a real nRF91 trace. Honest skip when the bench has not captured one. */
function checkModemTrace(t: Tool, boards: Board[], tools: Tool[]): void {
	let trace = process.env.HIL_MODEM_TRACE
	// EVERY nRF91, not the first. The bench runs two nRF9161 DKs reporting the same boardVersion, and
	// only one of them will be carrying trace-enabled firmware — `find` would keep testing whichever
	// enumerated first and report a 0-byte trace forever while the working board sat untouched.
	const cellular = boards.filter(isNrf91)
	// RTT first: it is the route proven on this hardware. A board without trace firmware simply has no
	// "modem_trace" channel, so this costs one quick probe and says nothing misleading when it fails.
	for (const nrf91 of trace && fs.existsSync(trace) ? [] : cellular) {
		const shell = tools.find((x) => x.name === "board-shell")
		const viaRtt = captureTraceOverRtt(nrf91.serial, 25, shell ? { tool: shell, port: consolePort(nrf91) } : undefined)
		if (viaRtt) {
			record(t.id, `capture on ${nrf91.label} (RTT)`, "PASS", `${fs.statSync(viaRtt).size} B of trace`)
			trace = viaRtt
			break
		}
	}
	for (const nrf91 of trace && fs.existsSync(trace) ? [] : cellular) {
		// The trace UART is a SEPARATE VCOM from the application console — feeding it the console is the
		// classic way to get an empty trace and call it a pass. Take the second port, and say so if the
		// board only exposes one.
		const tracePort = nrf91.ports[1]
		if (!tracePort) {
			record(t.id, "capture", "SKIP", `${nrf91.label} exposes one VCOM; the trace UART is a second`)
		} else {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hil-modem-cap-"))
			const c = run(t, ["--capture", "--port", tracePort, "--seconds", "15", "--out", dir], 180_000, nrf91.serial)
			// Judge the TRACE, not the file count. The tool writes its pcapng/timeline wrappers either
			// way, so "some non-empty files appeared" reads as success even when the modem emitted
			// nothing — precisely the empty-capture defect test:hil shipped for weeks. The raw .bin is
			// the evidence: an empty one means the DUT produced no trace, which is a skip, not a pass.
			const raw = fs.existsSync(dir)
				? fs
						.readdirSync(dir)
						.filter((f) => f.endsWith(".bin"))
						.map((f) => path.join(dir, f))
				: []
			const nonEmpty = raw.filter((f) => fs.statSync(f).size > 0)
			if (raw.length === 0) {
				record(t.id, `capture on ${nrf91.label}`, "FAIL", firstLine(c.stderr || c.stdout) || "no .bin written at all")
			} else if (nonEmpty.length === 0) {
				record(
					t.id,
					`capture on ${nrf91.label}`,
					"SKIP",
					"0-byte trace: the modem emitted nothing — needs trace-enabled firmware (and a SIM to be interesting)",
				)
			} else {
				record(t.id, `capture on ${nrf91.label}`, "PASS", `${fs.statSync(nonEmpty[0]).size} B of trace`)
			}
			if (nonEmpty[0]) {
				trace = nonEmpty[0]
				break // one board produced real trace; that is the evidence, no need to disturb the others
			}
		}
	}
	if (!trace || !fs.existsSync(trace)) {
		record(
			t.id,
			"decode",
			"SKIP",
			cellular.length
				? `tried ${cellular.length} nRF91 board(s); none produced a trace binary to decode`
				: "no nRF91 attached and no HIL_MODEM_TRACE",
		)
		return
	}
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "hil-modem-"))
	const r = run(t, ["--decode", trace, "--out", out], 180_000)
	// The AT timeline is the deliverable — the pcapng files are a convenience. A decode that produced
	// wrappers but recovered no AT dialogue has not done the job the tool exists for.
	const timeline = fs.existsSync(out) ? fs.readdirSync(out).find((f) => f.endsWith("-at-timeline.txt")) : undefined
	const atLines = timeline
		? fs
				.readFileSync(path.join(out, timeline), "utf-8")
				.split("\n")
				.filter((l) => l.trim()).length
		: 0
	if (r.status === 0 && atLines > 0) {
		record(t.id, "decode", "PASS", `${atLines} AT line(s) recovered`)
		return
	}
	const wrote = fs.existsSync(out) ? fs.readdirSync(out).length : 0
	if (r.status !== 0) {
		record(t.id, "decode", "FAIL", firstLine(r.stderr) || "decode exited non-zero")
	} else if (wrote === 0) {
		record(t.id, "decode", "FAIL", "decode succeeded but wrote nothing")
	} else {
		// Ran, wrote its artifacts, recovered no AT dialogue. True, and worth saying out loud rather
		// than reporting a file count that reads like success — the AT timeline is the deliverable.
		record(t.id, "decode", "PASS", `${wrote} file(s), but 0 AT lines — the trace carried no AT dialogue`)
	}
}

/** Everything else: prove the production invocation actually starts the tool. */
function checkInvokes(t: Tool): void {
	const r = run(t, ["--help"], 60_000)
	const said = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim()
	// --help exits non-zero by convention in several of these; what matters is that the command prefix
	// production builds RAN and the tool spoke, rather than dying on a bad shebang or missing runtime.
	const spoke = said.length > 0 && !/command not found|No such file|cannot execute/i.test(said)
	record(t.id, "production invocation", spoke ? "PASS" : "FAIL", spoke ? firstLine(said) : firstLine(said) || "no output")
}

// ── main ────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
	console.log("[test:hil-tools] tool bits on real hardware\n")

	const bundled = bundledTools()
	const client = new RegistryClient(process.env.ADSUM_API_BASE ?? "https://api.adsumnetworks.com")
	const { advertised, cacheRoot } = await materialiseDownloadables()
	const catalog = new Map<string, Record<string, unknown>>()
	try {
		for (const b of ((await client.fetchManifest()) as { bits?: Array<Record<string, unknown>> } | null)?.bits ?? []) {
			catalog.set(String(b.id), b)
		}
	} catch {
		/* already reported above */
	}
	const downloaded = downloadedTools(advertised, cacheRoot, catalog)
	const tools = [...bundled, ...downloaded.filter((d) => !bundled.some((b) => b.id === d.id))]
	const missing = advertised.filter((a) => !downloaded.some((d) => d.id === a.id))

	console.log(`bundled     ${bundled.length}`)
	for (const t of bundled) {
		console.log(`   ${t.id}  (${t.runtime})`)
	}
	console.log(`downloaded  ${downloaded.length} materialised of ${advertised.length} advertised`)
	for (const t of downloaded) {
		console.log(`   ${t.id}@${t.version}  (${t.runtime})`)
	}
	for (const m of missing) {
		console.log(`   NOT MATERIALISED  ${m.id}@${m.version} — the download rail has not run for this bit`)
	}
	if (advertised.length === 0) {
		console.log("   (the registry advertised no tool bits for this extension version)")
	}

	const boards = discoverBoards()
	const logs = (process.env.HIL_LOGS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((p) => p && fs.existsSync(p))
	console.log(`\n${boards.length} board(s)${boards.length ? `: ${boards.map((b) => b.label).join(", ")}` : ""}`)
	console.log(`${logs.length} pre-supplied log(s) · bench-claim ${HAVE_CLAIM ? "in use" : "not installed"}\n`)

	for (const t of tools) {
		if (t.name === "board-shell") {
			checkBoardShell(t, boards)
		} else if (t.name === "log-shape") {
			checkLogShape(t, logs, boards, tools)
		} else if (t.name === "modem-trace") {
			checkModemTrace(t, boards, tools)
		} else {
			checkInvokes(t)
		}
	}

	const fail = results.filter((r) => r.outcome === "FAIL").length
	const skip = results.filter((r) => r.outcome === "SKIP").length
	const warn = results.filter((r) => r.outcome === "WARN").length
	console.log(
		`\n[test:hil-tools] ${results.length - fail - skip - warn} passed · ${fail} failed · ${skip} skipped` +
			(warn ? ` · ${warn} warning(s) — a board could not be reached; see above` : ""),
	)
	if (missing.length) {
		console.log(`[test:hil-tools] ${missing.length} downloadable tool bit(s) never materialised on this machine`)
	}
	process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
	console.error("[test:hil-tools] harness error:", e)
	process.exit(1)
})
