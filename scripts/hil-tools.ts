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

import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { commandPrefix, launcherName, type ToolRuntime } from "../src/services/tools/launchers"
import { safeSegment } from "../src/services/tools/ToolCache"

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
type Outcome = "PASS" | "FAIL" | "SKIP"
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
 * Downloadable tool bits, and whether each is materialised. The k-bit cache's manifest is the
 * registry's own list; the T-bit cache beside it is where verified bundles land.
 */
function downloadableTools(): { advertised: { id: string; version: string }[]; tools: Tool[] } {
	const gs = globalStorage()
	const kmf = path.join(gs, "kbit-cache", "manifest.json")
	const tcache = path.join(gs, "tbit-cache")
	const advertised: { id: string; version: string }[] = []
	const tools: Tool[] = []
	if (!fs.existsSync(kmf)) {
		return { advertised, tools }
	}
	let bits: Array<Record<string, unknown>> = []
	try {
		bits = JSON.parse(fs.readFileSync(kmf, "utf-8")).bits ?? []
	} catch {
		return { advertised, tools }
	}
	for (const b of bits) {
		// Production's filter: a tool bit with declared artifacts is the downloadable shape.
		if (b.type !== "tool" || !Array.isArray(b.artifacts) || b.artifacts.length === 0) {
			continue
		}
		const id = String(b.id ?? "")
		const version = String(b.version ?? "")
		if (!id || !version) {
			continue
		}
		advertised.push({ id, version })
		const dir = path.join(tcache, safeSegment(id), version)
		const t = toolAt(id, dir, { runtime: String(b.runtime ?? ""), entry: String(b.entry ?? ""), version }, "downloaded")
		if (t) {
			tools.push(t)
		}
	}
	return { advertised, tools }
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
	let ok = 0
	for (const b of boards.slice(0, 2)) {
		// A Zephyr shell answers `kernel version`. A board with no shell simply returns nothing — which
		// is a legitimate answer and still exercises the whole open/write/read/close path the tool owns.
		const r = run(t, ["--port", consolePort(b), "--cmd", "kernel version", "--timeout", "8"], 90_000, b.serial)
		if (r.status === 0) {
			ok++
			record(t.id, `talk to ${b.label}`, "PASS", firstLine((r.stdout || "").split("\n").filter(Boolean).pop() ?? ""))
		} else {
			record(t.id, `talk to ${b.label}`, "FAIL", firstLine(r.stderr || r.stdout))
		}
	}
	record(t.id, "two-board coverage", ok >= 2 ? "PASS" : "FAIL", `${ok}/2 boards answered`)
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

/** modem-trace — needs a real nRF91 trace. Honest skip when the bench has not captured one. */
function checkModemTrace(t: Tool, boards: Board[]): void {
	let trace = process.env.HIL_MODEM_TRACE
	const nrf91 = boards.find(isNrf91)
	if ((!trace || !fs.existsSync(trace)) && nrf91) {
		// The trace UART is a SEPARATE VCOM from the application console — feeding it the console is the
		// classic way to get an empty trace and call it a pass. Take the second port, and say so if the
		// board only exposes one.
		const tracePort = nrf91.ports[1]
		if (!tracePort) {
			record(t.id, "capture", "SKIP", `${nrf91.label} exposes one VCOM; the trace UART is a second`)
		} else {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hil-modem-cap-"))
			const c = run(t, ["--capture", "--port", tracePort, "--seconds", "15", "--out", dir], 180_000, nrf91.serial)
			const bins = fs.existsSync(dir)
				? fs
						.readdirSync(dir)
						.map((f) => path.join(dir, f))
						.filter((f) => fs.statSync(f).size > 0)
				: []
			record(
				t.id,
				`capture on ${nrf91.label}`,
				bins.length ? "PASS" : "FAIL",
				bins.length ? `${bins.length} file(s)` : firstLine(c.stderr || c.stdout),
			)
			trace = bins.find((f) => f.endsWith(".bin")) ?? trace
		}
	}
	if (!trace || !fs.existsSync(trace)) {
		record(
			t.id,
			"decode",
			"SKIP",
			nrf91 ? "capture produced no trace binary to decode" : "no nRF91 attached and no HIL_MODEM_TRACE",
		)
		return
	}
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "hil-modem-"))
	const r = run(t, ["--decode", trace, "--out", out], 180_000)
	const wrote = fs.existsSync(out) ? fs.readdirSync(out).length : 0
	record(
		t.id,
		"decode",
		r.status === 0 && wrote > 0 ? "PASS" : "FAIL",
		r.status === 0 ? `${wrote} file(s)` : firstLine(r.stderr),
	)
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
function main(): void {
	console.log("[test:hil-tools] tool bits on real hardware\n")

	const bundled = bundledTools()
	const { advertised, tools: downloaded } = downloadableTools()
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
		console.log("   (no registry manifest cached — open the extension once so it syncs)")
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
			checkModemTrace(t, boards)
		} else {
			checkInvokes(t)
		}
	}

	const fail = results.filter((r) => r.outcome === "FAIL").length
	const skip = results.filter((r) => r.outcome === "SKIP").length
	console.log(`\n[test:hil-tools] ${results.length - fail - skip} passed · ${fail} failed · ${skip} skipped`)
	if (missing.length) {
		console.log(`[test:hil-tools] ${missing.length} downloadable tool bit(s) never materialised on this machine`)
	}
	process.exit(fail > 0 ? 1 : 0)
}

main()
