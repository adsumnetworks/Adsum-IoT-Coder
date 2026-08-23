#!/usr/bin/env node
/**
 * Boot the engine exactly as an installed VSIX presents it.
 *
 * From 0.3.1 the engine ships inside the extension package, which means three things can break in ways no
 * unit test sees: `.vscodeignore` can drop a module the engine requires, the per-platform better-sqlite3
 * addon can fail to resolve from a read-only install, and the extension root can be looked for in the
 * unpacked layout that an installed VSIX does not have. All three only show up when the thing actually runs.
 *
 * So: extract the packaged VSIX to a temp dir — that is byte-for-byte what VS Code lays down — and start
 * `dist-standalone/cline-core.js` from it with NO INSTALL_DIR, the way a headless caller would. The engine
 * has booted when its ProtoBus port accepts a connection.
 *
 * The engine's better-sqlite3 addon is prebuilt for Node 22 — the runtime the bench and the packaged CLI use —
 * so this has to run under a Node with that ABI. Set NODE22_BIN (as the bench does) or run under Node 22; on any
 * other Node the addon refuses to load and the check SKIPS saying so, rather than reporting a packaging failure
 * that is really a local-Node mismatch. Set ADSUM_REQUIRE_ENGINE_BOOT=1 where the skip must be a failure.
 *
 * Skips (exit 0) when no VSIX has been built; run `npm run vsix` first for the real check.
 */
import { execFileSync, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PROTOBUS_PORT = 26140
const HOSTBRIDGE_PORT = 26141
const BOOT_TIMEOUT_MS = 60_000

const REQUIRED = process.env.ADSUM_REQUIRE_ENGINE_BOOT === "1"

const say = (m) => console.log(`[test:shipped-engine] ${m}`)
const skip = (m) => {
	if (REQUIRED) {
		fail(`${m} (ADSUM_REQUIRE_ENGINE_BOOT=1)`)
	}
	say(`SKIPPING — ${m}`)
	process.exit(0)
}
const fail = (m) => {
	console.error(`[test:shipped-engine] FAIL — ${m}`)
	process.exit(1)
}

function newestVsix() {
	const dist = path.join(REPO, "dist")
	if (!fs.existsSync(dist)) {
		return null
	}
	const found = fs
		.readdirSync(dist)
		.filter((f) => f.endsWith(".vsix"))
		.map((f) => ({ f, m: fs.statSync(path.join(dist, f)).mtimeMs }))
		.sort((a, b) => b.m - a.m)[0]
	return found ? path.join(dist, found.f) : null
}

const waitForPort = (port, deadline) =>
	new Promise((resolve) => {
		const attempt = () => {
			if (Date.now() > deadline) {
				return resolve(false)
			}
			const sock = net.connect({ port, host: "127.0.0.1" })
			sock.once("connect", () => {
				sock.destroy()
				resolve(true)
			})
			sock.once("error", () => {
				sock.destroy()
				setTimeout(attempt, 250)
			})
		}
		attempt()
	})

const vsix = newestVsix()
if (!vsix) {
	skip("no VSIX in dist/; run `npm run vsix` to check the shipped engine boots")
}

// The bench sets NODE22_BIN; honour it so the check runs on a machine whose default Node is newer.
const node22 = process.env.NODE22_BIN ? path.join(process.env.NODE22_BIN, "node") : null
const NODE = node22 && fs.existsSync(node22) ? node22 : process.execPath

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adsum-shipped-engine-"))
// Inside a VSIX every file lives under `extension/` — extracting therefore reproduces the installed layout.
execFileSync("unzip", ["-q", vsix, "-d", tmp])
const extRoot = path.join(tmp, "extension")
const core = path.join(extRoot, "dist-standalone", "cline-core.js")
if (!fs.existsSync(core)) {
	fail(`${path.basename(vsix)} does not contain dist-standalone/cline-core.js`)
}
say(`booting ${path.basename(vsix)} from ${extRoot}`)

const children = []
const stop = () => children.forEach((c) => !c.killed && c.kill("SIGKILL"))
process.on("exit", stop)

const hostbridge = spawn("npx", ["tsx", path.join(REPO, "scripts", "test-hostbridge-server.ts")], {
	cwd: REPO,
	stdio: "ignore",
	env: { ...process.env, HOST_BRIDGE_ADDRESS: `127.0.0.1:${HOSTBRIDGE_PORT}`, TEST_HOSTBRIDGE_WORKSPACE_DIR: tmp },
})
children.push(hostbridge)

let out = ""
const engine = spawn(NODE, [core], {
	cwd: tmp,
	env: {
		...process.env,
		// Deliberately NO INSTALL_DIR: the shipped engine must find its own extension root.
		CLINE_DIR: path.join(tmp, "cline"),
		PROTOBUS_ADDRESS: `127.0.0.1:${PROTOBUS_PORT}`,
		HOST_BRIDGE_ADDRESS: `127.0.0.1:${HOSTBRIDGE_PORT}`,
		WORKSPACE_STORAGE_DIR: path.join(tmp, "workspace"),
	},
	stdio: ["ignore", "pipe", "pipe"],
})
children.push(engine)
engine.stdout.on("data", (d) => {
	out += d
})
engine.stderr.on("data", (d) => {
	out += d
})
let exited = null
engine.on("exit", (code) => {
	exited = code
})

const up = await waitForPort(PROTOBUS_PORT, Date.now() + BOOT_TIMEOUT_MS)
stop()

const tail = out.split("\n").slice(-40).join("\n")

// Classify before judging the port, so the message names the actual cause rather than "never served".
if (/was compiled against a different Node\.js version|NODE_MODULE_VERSION/.test(out)) {
	const v = execFileSync(NODE, ["-p", "process.version + ' (ABI ' + process.versions.modules + ')'"], {
		encoding: "utf8",
	}).trim()
	skip(
		`this Node ${v} cannot load the engine's better-sqlite3 addon, which is prebuilt for Node 22 — run under Node 22 or set NODE22_BIN`,
	)
}
if (/Cannot find module|MODULE_NOT_FOUND/.test(out)) {
	console.error(tail)
	fail(
		`a module the engine requires is missing from the package: ${/Cannot find module '([^']+)'/.exec(out)?.[1] ?? "see above"}`,
	)
}
if (/invalid ELF header|not a valid Win32 application|mach-o/i.test(out)) {
	console.error(tail)
	fail("the better-sqlite3 addon shipped for this platform is the wrong architecture")
}
if (!up) {
	console.error(tail)
	fail(exited !== null ? `the engine exited with code ${exited} before serving` : "the engine never served on ProtoBus")
}
// The boot contract: with no INSTALL_DIR the engine must resolve the extension root, not `<engine>/extension`.
const dir = /Using extension dir:\s*(\S+)/.exec(out)?.[1]
// realpath both sides: on macOS the temp root is /var -> /private/var, and only one of the two goes through it.
const same = (a, b) => fs.realpathSync(a) === fs.realpathSync(b)
if (dir && !same(dir, extRoot)) {
	console.error(tail)
	fail(`the engine took ${dir} as its extension dir; the installed layout puts it at ${extRoot}`)
}
fs.rmSync(tmp, { recursive: true, force: true })
say(`PASS — shipped engine served on ProtoBus, extension dir ${dir ? "resolved to the package root" : "unreported"}`)
