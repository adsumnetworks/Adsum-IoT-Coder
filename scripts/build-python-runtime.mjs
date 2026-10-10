#!/usr/bin/env node
/**
 * Build the Python the extension carries for its Python tool bits, per platform: a portable CPython with the
 * packages those tools need, so a developer installs nothing.
 *
 * Why (operator, 10 Oct 2026: "whatever tool you choose should be included in the extension"). The gateway service
 * tool talks Bluetooth through bleak, which binds the OS natively (CoreBluetooth through pyobjc, WinRT, BlueZ over
 * D-Bus) and cannot be vendored as source; a developer's Python often cannot install it (measured: macOS's own
 * Python 3.9 with pip 21 fails to build pyobjc-core), and the tools' launchers isolate user-site packages anyway.
 * The TOOL itself stays a registry bit, per account (moved out of the bundle in 0.4.5); what ships here is the
 * runtime it runs on. ToolResolver prefers this Python for the tools listed in BUNDLED_PYTHON_TOOLS.
 *
 *   node scripts/build-python-runtime.mjs                  # this computer's platform
 *   node scripts/build-python-runtime.mjs darwin-arm64 win32-x64 linux-x64 darwin-x64 linux-arm64
 *
 * Every target builds from this one machine: the CPython is python-build-standalone's relocatable build for the
 * target (checked against the release's SHA256SUMS), and the packages are the target's own wheels, named one by
 * one per platform (pip judges dependency markers by the machine it runs on, so dependencies are never resolved
 * for another platform). Output: runtimes/python/<os>-<arch>/python/ plus ADSUM-RUNTIME.json (what is inside and
 * where it came from). A build artifact, never committed; `npm run vsix:target -- <os>-<arch>` packages one.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT_ROOT = path.join(ROOT, "runtimes", "python")
const CACHE = path.join(ROOT, ".cache", "python-runtime")
const PBS_RELEASE = "20261009"
const CPYTHON = "3.12.15"
const PY_TAG = "312"

// The packages, by platform. Exact pins for what the service tool was proven with on 10 Oct 2026.
const COMMON = ["bleak==3.0.2", "cryptography==50.0.2", "cffi==2.1.1", "pycparser==2.23", "pyserial==3.5"]
const DARWIN = [
	"pyobjc-core==12.2.2",
	"pyobjc-framework-Cocoa==12.2.2",
	"pyobjc-framework-CoreBluetooth==12.2.2",
	"pyobjc-framework-libdispatch==12.2.2",
]
const WIN = [
	"winrt-runtime",
	"winrt-Windows.Devices.Bluetooth",
	"winrt-Windows.Devices.Bluetooth.Advertisement",
	"winrt-Windows.Devices.Bluetooth.GenericAttributeProfile",
	"winrt-Windows.Devices.Enumeration",
	"winrt-Windows.Devices.Radios",
	"winrt-Windows.Foundation",
	"winrt-Windows.Foundation.Collections",
	"winrt-Windows.Storage.Streams",
]
const LINUX = ["dbus-fast"]

const TARGETS = {
	"darwin-arm64": { triple: "aarch64-apple-darwin", tags: ["macosx_11_0_arm64"], pkgs: DARWIN },
	// cryptography 49 and later publish no Intel-Mac wheel; 48.0.1 is the last (checked 10 Oct 2026).
	"darwin-x64": { triple: "x86_64-apple-darwin", tags: ["macosx_12_0_x86_64"], pkgs: DARWIN, pin: { cryptography: "48.0.1" } },
	"linux-x64": {
		triple: "x86_64-unknown-linux-gnu",
		tags: ["manylinux_2_34_x86_64", "manylinux_2_28_x86_64", "manylinux_2_17_x86_64", "manylinux2014_x86_64", "linux_x86_64"],
		pkgs: LINUX,
	},
	"linux-arm64": {
		triple: "aarch64-unknown-linux-gnu",
		tags: [
			"manylinux_2_34_aarch64",
			"manylinux_2_28_aarch64",
			"manylinux_2_17_aarch64",
			"manylinux2014_aarch64",
			"linux_aarch64",
		],
		pkgs: LINUX,
	},
	"win32-x64": { triple: "x86_64-pc-windows-msvc", tags: ["win_amd64"], pkgs: WIN },
}

// What a tool never needs, trimmed so a platform VSIX carries about 23 MB rather than 47.
const TRIM = [
	"test",
	"idlelib",
	"tkinter",
	"turtledemo",
	"turtle.py",
	"lib2to3",
	"ensurepip",
	"pydoc_data",
	"unittest/test",
	"site-packages/PyObjCTest",
	"site-packages/pip",
	"site-packages/setuptools",
]

const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 << 20, ...opts })

function hostPython() {
	for (const c of ["python3.12", "python3.11", "python3.10", "python3", "python"]) {
		try {
			const v = Number(run(c, ["-c", "import sys; print(sys.version_info[0]*100+sys.version_info[1])"]).trim())
			if (v >= 310) return c
		} catch {
			// next
		}
	}
	throw new Error("no Python 3.10 or newer on PATH to run pip with")
}

function rmAll(p) {
	// rmSync looks at the path itself (lstat), so a dangling alias goes too; existsSync would follow it and say no.
	rmSync(p, { recursive: true, force: true })
}

/**
 * One interpreter, one name. A VSIX is a zip and keeps no symlink: every alias (python, python3 -> python3.12) would
 * become another full copy of an 18 MB binary. The resolver runs bin/python3 (Windows: python.exe), so that is the one
 * real file kept; the other launchers (pip, idle, pydoc, 2to3, -config) and the library's unversioned alias go.
 */
function oneInterpreter(pyRoot, win) {
	if (win) return
	const bin = path.join(pyRoot, "bin")
	const real = path.join(bin, `python${CPYTHON.split(".").slice(0, 2).join(".")}`)
	const want = path.join(bin, "python3")
	rmAll(want)
	renameSync(real, want)
	for (const n of readdirSync(bin)) if (n !== "python3") rmAll(path.join(bin, n))
	const lib = path.join(pyRoot, "lib")
	for (const n of readdirSync(lib)) {
		const p = path.join(lib, n)
		if (lstatSync(p).isSymbolicLink()) rmAll(p)
	}
}

function trim(pyRoot, libDir) {
	for (const t of TRIM) rmAll(path.join(libDir, t))
	for (const d of ["include", "share"]) rmAll(path.join(pyRoot, d))
	const lib = path.join(pyRoot, "lib")
	if (existsSync(lib)) {
		for (const n of readdirSync(lib)) {
			if (/^(libtcl|libtk|tcl|tk|itcl|thread|pkgconfig)/.test(n)) rmAll(path.join(lib, n))
		}
	}
	const dyn = path.join(libDir, "lib-dynload")
	if (existsSync(dyn)) for (const n of readdirSync(dyn)) if (n.startsWith("_tkinter")) rmAll(path.join(dyn, n))
	const walk = (d) => {
		for (const n of readdirSync(d)) {
			const p = path.join(d, n)
			const s = statSync(p, { throwIfNoEntry: false })
			if (!s?.isDirectory()) continue
			if (n === "__pycache__") rmAll(p)
			else walk(p)
		}
	}
	walk(pyRoot)
}

async function fetchTo(url, file) {
	if (existsSync(file)) return
	const r = await fetch(url)
	if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
	writeFileSync(file, Buffer.from(await r.arrayBuffer()))
}

async function build(key) {
	const t = TARGETS[key]
	if (!t) throw new Error(`unknown target ${key} (one of ${Object.keys(TARGETS).join(", ")})`)
	mkdirSync(CACHE, { recursive: true })
	const asset = `cpython-${CPYTHON}+${PBS_RELEASE}-${t.triple}-install_only_stripped.tar.gz`
	const base = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}`
	const sums = path.join(CACHE, `SHA256SUMS-${PBS_RELEASE}`)
	await fetchTo(`${base}/SHA256SUMS`, sums)
	const want = readFileSync(sums, "utf8")
		.split("\n")
		.find((l) => l.trim().endsWith(asset))
		?.split(/\s+/)[0]
	if (!want) throw new Error(`${asset} is not in the release's SHA256SUMS`)
	const tgz = path.join(CACHE, asset)
	await fetchTo(`${base}/${encodeURIComponent(asset)}`, tgz)
	const got = createHash("sha256").update(readFileSync(tgz)).digest("hex")
	if (got !== want) throw new Error(`${asset}: sha256 ${got}, the release says ${want}`)

	const dest = path.join(OUT_ROOT, key)
	rmAll(dest)
	mkdirSync(dest, { recursive: true })
	run("tar", ["-xzf", tgz, "-C", dest])
	const pyRoot = path.join(dest, "python")
	const win = key.startsWith("win32")
	const libDir = win ? path.join(pyRoot, "Lib") : path.join(pyRoot, "lib", `python${CPYTHON.split(".").slice(0, 2).join(".")}`)
	const site = path.join(libDir, "site-packages")
	const pkgs = [...COMMON, ...t.pkgs].map((p) => {
		const name = p.split("==")[0]
		return t.pin?.[name] ? `${name}==${t.pin[name]}` : p
	})
	const platformArgs = t.tags.flatMap((p) => ["--platform", p])
	run(hostPython(), [
		"-m",
		"pip",
		"install",
		"--quiet",
		"--no-deps",
		"--no-compile",
		"--only-binary=:all:",
		"--python-version",
		CPYTHON.split(".").slice(0, 2).join("."),
		"--implementation",
		"cp",
		"--abi",
		`cp${PY_TAG}`,
		"--abi",
		"abi3",
		"--abi",
		"none",
		...platformArgs,
		"--target",
		site,
		"--upgrade",
		...pkgs,
	])
	trim(pyRoot, libDir)
	oneInterpreter(pyRoot, win)
	for (const n of readdirSync(site)) if (/^(pip|setuptools)([-_.]|$)/i.test(n)) rmAll(path.join(site, n))
	const installed = readdirSync(site)
		.filter((n) => n.endsWith(".dist-info"))
		.map((n) => n.replace(/\.dist-info$/, "").replace(/-(\d[^-]*)$/, "==$1"))
		.sort()
	writeFileSync(
		path.join(dest, "ADSUM-RUNTIME.json"),
		JSON.stringify(
			{ platform: key, cpython: CPYTHON, source: `${base}/${asset}`, sha256: got, packages: installed },
			null,
			2,
		) + "\n",
	)
	// The target this machine can run: prove the packages import, with user-site isolated as the tools run it.
	if (key === `${process.platform}-${process.arch}`) {
		const exe = win ? path.join(pyRoot, "python.exe") : path.join(pyRoot, "bin", "python3")
		const v = run(exe, ["-s", "-c", "import bleak, cryptography, serial, sys; print(sys.version.split()[0])"]).trim()
		console.log(`${key}: Python ${v} runs bleak, cryptography and pyserial`)
	}
	console.log(`${key}: ${installed.length} packages -> ${path.relative(ROOT, dest)}`)
}

const want = process.argv.slice(2)
for (const key of want.length ? want : [`${process.platform}-${process.arch}`]) {
	await build(key)
}
