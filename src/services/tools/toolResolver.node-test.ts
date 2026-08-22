/**
 * Tool-bit resolution: what gets advertised, what never does, and how a tool is actually launched.
 * The pure functions take injected fs/probe seams so these run with no extension host and no hardware.
 */
import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { commandPrefix, launcherName, renderCommand } from "./launchers"
import { buildResolvedTool, type ResolvedTool, toolEntriesFromManifest, toolsForWorkspace } from "./ToolResolver"

const DIR = "/ext/iot-knowledge/platforms/nrf/tools/rtt-logger"
const META = {
	id: "adsum/nrf/tools/rtt-logger",
	type: "tool",
	runtime: "python3",
	entry: "nrf_rtt_logger.py",
	usage: "--capture --port <PORT>",
	safety: ["shell"],
	platform: "nrf",
	author: "Adsum authoring team",
}
const base = {
	id: "adsum/nrf/tools/rtt-logger",
	dir: DIR,
	meta: META as Record<string, unknown>,
	body: "Capture Segger RTT output.\n",
	delivery: "bundled" as const,
	interpreter: "python3",
	haveExecutable: () => true,
	platform: "linux" as NodeJS.Platform,
}
const exists =
	(...present: string[]) =>
	(p: string) =>
		present.includes(p)

// ── rule 1: never advertise a tool that cannot run ───────────────────────────
test("a tool whose entry file is absent is not advertised at all", () => {
	const t = buildResolvedTool({ ...base, fileExists: exists() })
	assert.equal(t, null, "no entry on disk ⇒ no promise to the agent")
})

test("a descriptor missing runtime or entry is not a runnable tool", () => {
	assert.equal(buildResolvedTool({ ...base, meta: { ...META, entry: undefined }, fileExists: () => true }), null)
	assert.equal(buildResolvedTool({ ...base, meta: { ...META, runtime: undefined }, fileExists: () => true }), null)
})

test("a missing interpreter is stated in the line, not hidden", () => {
	const t = buildResolvedTool({ ...base, interpreter: null, fileExists: exists(path.join(DIR, "nrf_rtt_logger.py")) })
	assert.ok(t)
	assert.match(t!.unavailable ?? "", /needs Python 3/)
})

test("a missing external executable is named", () => {
	const t = buildResolvedTool({
		...base,
		meta: { ...META, requires_tools: ["nrfutil"] },
		haveExecutable: () => false,
		fileExists: exists(path.join(DIR, "nrf_rtt_logger.py")),
	})
	assert.match(t!.unavailable ?? "", /nrfutil not found on PATH/)
})

// ── launching ────────────────────────────────────────────────────────────────
test("a bundle's own launcher wins over a generated one — the wrappers carry the Store-stub probe", () => {
	const t = buildResolvedTool({
		...base,
		fileExists: exists(path.join(DIR, "nrf_rtt_logger.py"), path.join(DIR, "rtt-logger")),
	})
	assert.equal(t!.command, path.join(DIR, "rtt-logger"))
})

test("without a launcher the host builds the command from runtime + entry", () => {
	const t = buildResolvedTool({ ...base, fileExists: exists(path.join(DIR, "nrf_rtt_logger.py")) })
	assert.equal(t!.command, `python3 ${path.join(DIR, "nrf_rtt_logger.py")}`)
})

test("node and wasm run under the editor's own Node — nothing for the developer to install", () => {
	assert.deepEqual(commandPrefix({ runtime: "node", entryPath: "/t/x.js", nodePath: "/n" }), ["/n", "/t/x.js"])
	assert.deepEqual(commandPrefix({ runtime: "wasm", entryPath: "/t/x.js", nodePath: "/n" }), ["/n", "/t/x.js"])
})

test("windows asks for the .bat sibling", () => {
	assert.equal(launcherName("rtt-logger", "win32"), "rtt-logger.bat")
	assert.equal(launcherName("rtt-logger", "darwin"), "rtt-logger")
})

test("a path containing spaces is quoted, on every platform", () => {
	// The real install path is ".../Adsum IoT Coder/..." — unquoted, the shell splits it and the
	// command runs as `./Adsum`, which is exactly the failure this guards.
	const cmd = renderCommand(["/Users/x/Adsum IoT Coder/tools/rtt-logger"])
	assert.equal(cmd, '"/Users/x/Adsum IoT Coder/tools/rtt-logger"')
})

test("a command is shortened to a workspace-relative path when that is shorter and stays inside", () => {
	assert.equal(renderCommand(["/w/tools/t"], "/w"), "./tools/t")
	assert.equal(renderCommand(["/elsewhere/t"], "/w/deep/project"), "/elsewhere/t")
})

// ── platform gating mirrors the native device tools ──────────────────────────
const mk = (id: string, platform?: string): ResolvedTool => ({
	id,
	name: id.split("/").pop()!,
	dir: "",
	entryPath: "",
	runtime: "python3",
	usage: "",
	summary: "",
	safety: [],
	readonly: false,
	requiresTools: [],
	platform,
	delivery: "bundled",
	command: "",
})

test("nRF tools hide in an ESP-only workspace; ESP tools hide in an nRF-only one", () => {
	const tools = [mk("adsum/nrf/tools/rtt-logger", "nrf"), mk("adsum/esp/tools/esp-monitor", "esp")]
	assert.deepEqual(
		toolsForWorkspace(tools, "esp").map((t) => t.id),
		["adsum/esp/tools/esp-monitor"],
	)
	assert.deepEqual(
		toolsForWorkspace(tools, "nrf").map((t) => t.id),
		["adsum/nrf/tools/rtt-logger"],
	)
	assert.equal(toolsForWorkspace(tools, "both").length, 2)
	// An empty workspace shows both, matching nrfToolActive/espToolActive: scaffolding from scratch
	// happens before any project exists, and without the tool the agent improvises.
	assert.equal(toolsForWorkspace(tools, "none").length, 2)
})

test("a platform-agnostic tool is always available", () => {
	const tools = [mk("adsum/tools/log-shape")]
	for (const s of ["nrf", "esp", "both", "none"] as const) {
		assert.equal(toolsForWorkspace(tools, s).length, 1)
	}
})

// ── manifest reading ─────────────────────────────────────────────────────────
test("only TOOL.md entries are treated as tools, and junk never throws", () => {
	const m = JSON.stringify({
		bits: [
			{ id: "adsum/nrf/tools/rtt-logger", path: "platforms/nrf/tools/rtt-logger/TOOL.md" },
			{ id: "adsum/nrf/platform", path: "platforms/nrf/PLATFORM.md" },
		],
	})
	assert.deepEqual(
		toolEntriesFromManifest(m).map((e) => e.id),
		["adsum/nrf/tools/rtt-logger"],
	)
	assert.deepEqual(toolEntriesFromManifest("not json"), [])
})

// ── credit: tool bits are credited exactly like knowledge bits ────────────────
import { creditForTool, resetToolCredits, shouldCreditTool, toolForCommand } from "./toolCredit"

const tool = (id: string, command: string, extra: Partial<ResolvedTool> = {}): ResolvedTool => ({
	...mk(id),
	command,
	...extra,
})

test("a tool's credit carries the tool kind, so the UI renders the ⚙ mark", () => {
	const c = creditForTool(tool("adsum/nrf/tools/modem-trace", "x", { author: "Omar Morceli" }))
	assert.equal(c.kind, "tool")
	assert.equal(c.author, "Omar Morceli")
	assert.equal(c.attributed, true)
})

test("co-authors ride with the lead, as they do for a knowledge bit", () => {
	const c = creditForTool(tool("adsum/nrf/tools/t", "x", { author: "Ismail Hamdad", coAuthors: ["Omar Morceli"] }))
	assert.ok(c.coAuthors.includes("Omar Morceli"))
})

test("an unattributed tool falls back rather than inventing an author", () => {
	const c = creditForTool(tool("adsum/nrf/tools/t", "x", { author: undefined }))
	assert.equal(c.attributed, false)
})

test("a command is matched to the tool that produced it, quotes and all", () => {
	const tools = [tool("adsum/nrf/tools/rtt-logger", "./tools/rtt-logger")]
	assert.equal(toolForCommand("./tools/rtt-logger --capture --port /dev/ttyACM0", tools)?.id, "adsum/nrf/tools/rtt-logger")
	assert.equal(toolForCommand('"./tools/rtt-logger" --capture', tools)?.id, "adsum/nrf/tools/rtt-logger")
	assert.equal(toolForCommand("./tools/rtt-logger", tools)?.id, "adsum/nrf/tools/rtt-logger")
	assert.equal(toolForCommand("git status", tools), null)
})

test("a tool whose name prefixes another's cannot steal the credit", () => {
	const tools = [tool("adsum/t/log", "./log"), tool("adsum/t/log-shape", "./log-shape")]
	assert.equal(toolForCommand("./log-shape --kinds x.log", tools)?.id, "adsum/t/log-shape")
})

test("one credit line per tool per task, and different tasks credit independently", () => {
	resetToolCredits()
	assert.equal(shouldCreditTool("task-a", "adsum/t/x"), true)
	assert.equal(shouldCreditTool("task-a", "adsum/t/x"), false, "second run in the same task stays quiet")
	assert.equal(shouldCreditTool("task-a", "adsum/t/y"), true, "a different tool still credits")
	assert.equal(shouldCreditTool("task-b", "adsum/t/x"), true, "a new task credits again")
})

// ── cache: hash-verified, atomic, all-or-nothing ─────────────────────────────
import { existsSync as fsExists, readdirSync as fsReaddir, writeFileSync as fsWrite, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { bytesHash as cacheHash, safeSegment, ToolCache } from "./ToolCache"

const tmpRoot = () => mkdtempSync(path.join(tmpdir(), "toolcache-"))
const member = (p: string, s: string) => ({ path: p, bytes: Buffer.from(s), sha256: cacheHash(Buffer.from(s)) })

test("a bundle materialises and then verifies", () => {
	const c = new ToolCache(tmpRoot())
	const files = [member("t.py", "print(1)"), member("lib/h.py", "x=1")]
	assert.equal(c.materialise("adsum/nrf/tools/t", "1.0.0", files), true)
	assert.equal(
		c.verify(
			"adsum/nrf/tools/t",
			"1.0.0",
			files.map((f) => ({ path: f.path, sha256: f.sha256 })),
		),
		true,
	)
})

test("one bad member publishes nothing — a bundle missing a file breaks mid-capture", () => {
	const root = tmpRoot()
	const c = new ToolCache(root)
	const good = member("t.py", "print(1)")
	const bad = { path: "b.py", bytes: Buffer.from("real"), sha256: cacheHash(Buffer.from("claimed")) }
	assert.equal(c.materialise("adsum/t/x", "1.0.0", [good, bad]), false)
	assert.equal(fsExists(c.dirFor("adsum/t/x", "1.0.0")), false, "no half-written bundle left behind")
	// The (empty) id directory may remain — harmless. What must not survive is a staging directory,
	// because reconcile treats those as collectable and nothing must ever execute out of one.
	const leftover = fsReaddir(root, { withFileTypes: true }).flatMap((d) =>
		d.isDirectory() ? fsReaddir(path.join(root, d.name)) : [],
	)
	assert.deepEqual(leftover, [], "no staging directory left behind")
})

test("a member path that escapes the bundle is refused even though the server also checks", () => {
	const c = new ToolCache(tmpRoot())
	assert.equal(
		c.materialise("adsum/t/x", "1.0.0", [
			{ path: "../evil.py", bytes: Buffer.from("x"), sha256: cacheHash(Buffer.from("x")) },
		]),
		false,
	)
})

test("a tampered file fails verification — the check is on read, not only on download", () => {
	const c = new ToolCache(tmpRoot())
	const files = [member("t.py", "print(1)")]
	c.materialise("adsum/t/x", "1.0.0", files)
	fsWrite(path.join(c.dirFor("adsum/t/x", "1.0.0"), "t.py"), "print('evil')")
	assert.equal(
		c.verify(
			"adsum/t/x",
			"1.0.0",
			files.map((f) => ({ path: f.path, sha256: f.sha256 })),
		),
		false,
	)
})

test("reconcile keeps live versions, drops superseded ones and abandoned staging dirs", () => {
	const c = new ToolCache(tmpRoot())
	c.materialise("adsum/t/x", "1.0.0", [member("t.py", "a")])
	c.materialise("adsum/t/x", "1.1.0", [member("t.py", "b")])
	const removed = c.reconcile([{ id: "adsum/t/x", version: "1.1.0" }])
	assert.deepEqual(removed, [`${safeSegment("adsum/t/x")}/1.0.0`])
	assert.equal(fsExists(c.dirFor("adsum/t/x", "1.1.0")), true)
})

test("re-materialising the same version replaces it cleanly", () => {
	const c = new ToolCache(tmpRoot())
	c.materialise("adsum/t/x", "1.0.0", [member("old.py", "a")])
	assert.equal(c.materialise("adsum/t/x", "1.0.0", [member("new.py", "b")]), true)
	assert.equal(fsExists(path.join(c.dirFor("adsum/t/x", "1.0.0"), "old.py")), false, "stale member gone")
})
