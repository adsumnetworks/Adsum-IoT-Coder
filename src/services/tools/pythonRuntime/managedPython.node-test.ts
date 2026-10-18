/**
 * The extension's own Python, set up on the developer's computer: the facts per system, the archive unpacking, and
 * the small decisions of the setup. No network, no Python and no extension host is needed to run these.
 */
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, test } from "node:test"
import { expandWildcards, failureWords, isNetworkFailure, lockIsStale, toolProcessEnv } from "./ManagedPython"
import { extractTar, safeJoin } from "./tarExtract"
import {
	backendFor,
	CONSTRAINTS,
	healthCheckCode,
	interpreterInPortable,
	interpreterInVenv,
	looksLikeMissingModule,
	pbsAsset,
	pbsUrl,
	REQUIREMENTS,
	runtimeId,
	runtimeTarget,
	systemPythonCandidates,
	TARGETS,
} from "./targets"

describe("the facts per system", () => {
	test("each system a VS Code runs on maps to a portable Python, others to none", () => {
		assert.equal(runtimeTarget("win32", "x64"), "win32-x64")
		assert.equal(runtimeTarget("darwin", "arm64"), "darwin-arm64")
		assert.equal(runtimeTarget("linux", "x64"), "linux-x64")
		assert.equal(runtimeTarget("linux", "ia32"), null)
		assert.equal(runtimeTarget("freebsd", "x64"), null)
	})

	test("every download has a 64-hex checksum and names its own system", () => {
		for (const [t, f] of Object.entries(TARGETS)) {
			assert.match(f.sha256, /^[0-9a-f]{64}$/, t)
			assert.ok(pbsAsset(t as keyof typeof TARGETS).includes(f.triple), t)
		}
	})

	test("the download address is the release folder, or a mirror in its place", () => {
		assert.equal(
			pbsUrl("win32-x64"),
			"https://github.com/astral-sh/python-build-standalone/releases/download/20261009/cpython-3.12.15%2B20261009-x86_64-pc-windows-msvc-install_only_stripped.tar.gz",
		)
		assert.ok(pbsUrl("linux-x64", "https://mirror.example/pbs/").startsWith("https://mirror.example/pbs/cpython-3.12.15"))
	})

	test("the build folder name stays short (Windows cannot import past 260 characters by default)", () => {
		assert.equal(runtimeId("win32-x64"), "py312-win32-x64-r1")
		for (const t of Object.keys(TARGETS)) assert.ok(runtimeId(t as keyof typeof TARGETS).length <= 22, t)
	})

	test("the interpreter's place in a portable Python and in a venv", () => {
		assert.equal(interpreterInPortable("C:\\r", "win32"), "C:\\r\\python\\python.exe")
		assert.equal(interpreterInPortable("/r", "linux"), "/r/python/bin/python3")
		assert.equal(interpreterInVenv("C:\\v", "win32"), "C:\\v\\Scripts\\python.exe")
		assert.equal(interpreterInVenv("/v", "darwin"), "/v/bin/python")
	})
})

describe("what pip is asked for", () => {
	test("the tool's packages are pinned and pip resolves their dependencies (no hand-written list)", () => {
		assert.match(REQUIREMENTS, /^bleak==3\.0\.2$/m)
		assert.match(REQUIREMENTS, /^pyserial==3\.5$/m)
		assert.doesNotMatch(REQUIREMENTS, /winrt|pyobjc|dbus/i, "system packages come from bleak's own metadata")
		assert.doesNotMatch(REQUIREMENTS, /no-deps/)
	})

	test("an Intel Mac gets the last cryptography with a wheel for it, every other system the newer one", () => {
		assert.match(REQUIREMENTS, /cryptography==48\.0\.1 ; sys_platform == "darwin" and platform_machine == "x86_64"/)
		assert.match(REQUIREMENTS, /cryptography==50\.0\.2 ; sys_platform != "darwin" or platform_machine != "x86_64"/)
	})

	test("the known-good versions include the module 0.5.1 missed on Windows", () => {
		assert.match(CONSTRAINTS, /^typing-extensions==4\.16\.0$/m)
		assert.match(CONSTRAINTS, /^winrt-runtime==3\.2\.1$/m)
	})
})

describe("the health check", () => {
	test("it loads the system's own Bluetooth part, not only bleak (importing bleak passed on the broken package)", () => {
		assert.equal(backendFor("win32"), "winrt")
		assert.equal(backendFor("darwin"), "corebluetooth")
		assert.equal(backendFor("linux"), "bluezdbus")
		assert.match(
			healthCheckCode("win32"),
			/bleak\.backends\.winrt\.scanner, bleak\.backends\.winrt\.client, cryptography, serial/,
		)
		assert.match(healthCheckCode("linux"), /bleak\.backends\.bluezdbus\.scanner/)
	})

	test("a missing or broken module in a tool's answer asks for a repair; other failures do not", () => {
		assert.ok(looksLikeMissingModule("Bluetooth scan failed (No module named 'typing_extensions'): is Bluetooth on"))
		assert.ok(looksLikeMissingModule("ImportError: DLL load failed while importing _winrt"))
		assert.ok(!looksLikeMissingModule("Bluetooth radio is not powered on"))
		assert.ok(!looksLikeMissingModule(undefined))
	})
})

describe("Pythons already on the computer", () => {
	test("Windows: the launcher first, then PATH, then python.org, nRF Connect and ESP-IDF folders", () => {
		const c = systemPythonCandidates("win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "C:\\Users\\a")
		assert.deepEqual(c[0], { cmd: "py", args: ["-3.13"] })
		assert.ok(c.some((x) => x.cmd === "python" && x.args.length === 0))
		assert.ok(c.some((x) => x.cmd === "C:\\Users\\a\\AppData\\Local\\Programs\\Python\\Python312\\python.exe"))
		assert.ok(c.some((x) => x.cmd === "C:\\ncs\\toolchains\\*\\opt\\bin\\python.exe"))
	})

	test("macOS never lists Apple's /usr/bin/python3 first (3.9 cannot take the Mac packages)", () => {
		const c = systemPythonCandidates("darwin", {}, "/Users/a")
		assert.equal(c[0].cmd, "python3.13")
		assert.ok(!c.some((x) => x.cmd === "/usr/bin/python3"))
	})

	test("a wildcard folder expands to what is there, newest name first", () => {
		const dirs: Record<string, string[]> = { "C:\\ncs\\toolchains": ["2be090971e", "936afb6332"] }
		const got = expandWildcards("C:\\ncs\\toolchains\\*\\opt\\bin\\python.exe", (d) => dirs[d] ?? [], "\\")
		assert.deepEqual(got, [
			"C:\\ncs\\toolchains\\936afb6332\\opt\\bin\\python.exe",
			"C:\\ncs\\toolchains\\2be090971e\\opt\\bin\\python.exe",
		])
		assert.deepEqual(
			expandWildcards("/opt/nordic/ncs/toolchains/*/bin/python3", () => [], "/"),
			[],
		)
		assert.deepEqual(
			expandWildcards("/usr/bin/python3", () => [], "/"),
			["/usr/bin/python3"],
		)
	})
})

describe("the setup's small decisions", () => {
	test("a lock is stale when its window is gone or it is older than any setup", () => {
		const now = 10_000_000
		const host = os.hostname()
		assert.equal(
			lockIsStale(null, now, () => true),
			true,
		)
		assert.equal(
			lockIsStale({ pid: 1, at: now - 1000, host }, now, () => true),
			false,
		)
		assert.equal(
			lockIsStale({ pid: 1, at: now - 1000, host }, now, () => false),
			true,
		)
		assert.equal(
			lockIsStale({ pid: 1, at: now - 21 * 60_000, host }, now, () => true),
			true,
		)
		assert.equal(
			lockIsStale({ pid: 1, at: now - 1000, host: "another-computer" }, now, () => false),
			false,
		)
	})

	test("no network is told apart from other failures", () => {
		assert.ok(isNetworkFailure("fetch failed (ENOTFOUND)"))
		assert.ok(isNetworkFailure("WARNING: Retrying ... NewConnectionError: Failed to establish a new connection"))
		assert.ok(!isNetworkFailure("ERROR: No matching distribution found for winrt-runtime==3.2.1"))
	})

	test("a failure is one plain sentence that says what to do", () => {
		const w = failureWords(["could not download Python from github.com (fetch failed)"])
		assert.match(w, /^Bluetooth support could not be set up on this computer: could not download Python/)
		assert.match(w, /Check the internet connection/)
		assert.match(failureWords(["the Bluetooth library does not load (ImportError)"]), /Press Scan to try again/)
	})

	test("a tool's Python runs isolated from another installation, without regard to the case of the names", () => {
		const env = toolProcessEnv({
			PythonPath: "C:\\x",
			PYTHONHOME: "C:\\y",
			VIRTUAL_ENV: "C:\\v",
			PATH: "C:\\bin",
			HTTPS_PROXY: "http://p:3128",
		})
		assert.equal(env.PythonPath, undefined)
		assert.equal(env.PYTHONHOME, undefined)
		assert.equal(env.VIRTUAL_ENV, undefined)
		assert.equal(env.PATH, "C:\\bin")
		assert.equal(env.HTTPS_PROXY, "http://p:3128")
		assert.equal(env.PYTHONNOUSERSITE, "1")
	})
})

// ── a tiny tar writer, so the unpacker is tested against the formats it meets ──────────────────────────────────────

function header(name: string, size: number, flag: string, opts: { mode?: number; link?: string; prefix?: string } = {}): Buffer {
	const h = Buffer.alloc(512)
	h.write(name, 0, 100, "utf8")
	h.write(`${(opts.mode ?? 0o644).toString(8).padStart(7, "0")}\0`, 100, 8, "ascii")
	h.write("0000000\0", 108, 8, "ascii")
	h.write("0000000\0", 116, 8, "ascii")
	h.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii")
	h.write("00000000000\0", 136, 12, "ascii")
	h.write("        ", 148, 8, "ascii")
	h.write(flag, 156, 1, "ascii")
	if (opts.link) h.write(opts.link, 157, 100, "utf8")
	h.write("ustar\0", 257, 6, "ascii")
	h.write("00", 263, 2, "ascii")
	if (opts.prefix) h.write(opts.prefix, 345, 155, "utf8")
	let sum = 0
	for (const b of h) sum += b
	h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii")
	return h
}

function entry(
	name: string,
	body: string | Buffer,
	flag = "0",
	opts: { mode?: number; link?: string; prefix?: string } = {},
): Buffer {
	const data = typeof body === "string" ? Buffer.from(body) : body
	const pad = Buffer.alloc((512 - (data.length % 512)) % 512)
	return Buffer.concat([header(name, data.length, flag, opts), data, pad])
}

function pax(records: Record<string, string>): Buffer {
	const lines = Object.entries(records).map(([k, v]) => {
		const core = ` ${k}=${v}\n`
		let len = core.length + 1
		while (`${len}${core}`.length !== len) len = `${len}${core}`.length
		return `${len}${core}`
	})
	return entry("pax", lines.join(""), "x")
}

describe("unpacking the portable Python", () => {
	test("files with their mode, folders, a long pax name, a ustar prefix and a symbolic link", async () => {
		const dest = mkdtempSync(path.join(os.tmpdir(), "adsum-tar-"))
		try {
			const longName = `python/lib/python3.12/site-packages/${"winrt_windows_devices_bluetooth_".repeat(4)}x/__init__.py`
			const tar = Buffer.concat([
				entry("python/", "", "5", { mode: 0o755 }),
				entry("python/bin/python3.12", "#!binary", "0", { mode: 0o755 }),
				entry("python/bin/python3", "", "2", { link: "python3.12" }),
				pax({ path: longName }),
				entry("ignored-short-name", "long"),
				entry("init.py", "prefixed", "0", { prefix: "python/Lib" }),
				Buffer.alloc(1024),
			])
			const st = await extractTar(tar, dest, process.platform)
			assert.equal(readFileSync(path.join(dest, ...longName.split("/")), "utf8"), "long")
			assert.equal(readFileSync(path.join(dest, "python", "Lib", "init.py"), "utf8"), "prefixed")
			assert.equal(readFileSync(path.join(dest, "python", "bin", "python3.12"), "utf8"), "#!binary")
			if (process.platform !== "win32") {
				assert.equal(statSync(path.join(dest, "python", "bin", "python3.12")).mode & 0o111, 0o111)
				assert.equal(readFileSync(path.join(dest, "python", "bin", "python3"), "utf8"), "#!binary")
				assert.equal(st.links, 1)
			}
			assert.equal(st.files, 3)
		} finally {
			rmSync(dest, { recursive: true, force: true })
		}
	})

	test("a name or a link that would leave the folder stops the unpacking", async () => {
		assert.throws(() => safeJoin("/d", "../etc/passwd"))
		assert.throws(() => safeJoin("/d", "/etc/passwd"))
		assert.throws(() => safeJoin("C:\\d", "C:/Windows/x"))
		assert.equal(safeJoin("/d", "./python/x").replace(/\\/g, "/").endsWith("d/python/x"), true)
		if (process.platform !== "win32") {
			const dest = mkdtempSync(path.join(os.tmpdir(), "adsum-tar-"))
			try {
				const evil = Buffer.concat([entry("python/out", "", "2", { link: "../../etc" }), Buffer.alloc(1024)])
				await assert.rejects(extractTar(evil, dest, process.platform))
			} finally {
				rmSync(dest, { recursive: true, force: true })
			}
		}
	})
})
