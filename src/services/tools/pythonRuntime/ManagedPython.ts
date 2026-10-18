import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, promises as fsp, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Logger } from "@services/logging/Logger"
import { HostProvider } from "@/hosts/host-provider"
import { fetch } from "@/shared/net"
import { extractTarGz } from "./tarExtract"
import {
	CONSTRAINTS,
	healthCheckCode,
	interpreterInPortable,
	interpreterInVenv,
	MAX_SYSTEM_PY,
	MIN_SYSTEM_PY,
	PROBE_CODE,
	type PythonCommand,
	pbsAsset,
	pbsUrl,
	REQUIREMENTS,
	RUNTIME_REVISION,
	type RuntimeTarget,
	runtimeId,
	runtimeTarget,
	systemPythonCandidates,
	TARGETS,
} from "./targets"

/**
 * The extension's own Python for its Python tools (today the gateway service tool), set up on the developer's
 * computer the first time it is needed, checked before it is used, and repaired by itself when it breaks.
 *
 * Three ways, in order, until one gives a Python that passes the health check (targets.ts: the scan's own imports):
 *   A. a portable CPython for this system (python-build-standalone, SHA-256 checked), then `pip install` of the tool's
 *      packages WITH their dependencies, on this computer, so pip picks what this system needs;
 *   B. when A cannot download: a private environment (venv) from a Python already here (python.org, the nRF Connect
 *      toolchain, ESP-IDF), then the same `pip install`;
 *   C. when nothing can be installed: a Python already here that already has the packages.
 *
 * Everything lives in `<global storage>/pyrt/`: each build in its own folder, written in full and checked before
 * `current.json` names it, so a half-made build is never used and a build in use is never overwritten. A lock
 * folder keeps two editor windows from building at once. `setup.log` holds every command and its answer.
 *
 * Overrides (a company network, or a test): ADSUM_PYTHON_RUNTIME_DIR (the folder), ADSUM_PYTHON_RUNTIME_URL (a mirror
 * of the portable Python's release folder), ADSUM_PYTHON_SETUP_WAYS (for example "BC" to skip the download).
 */

export type PythonSource = "download" | "system-venv" | "system"

export interface ManagedPythonInfo {
	python: string
	source: PythonSource
	/** The build folder (absent for a system Python used as it is). */
	dir?: string
	at: string
	ext?: string
	pythonVersion?: string
	bleak?: string
}

export type EnsureResult = { ok: true; python: string; source: PythonSource } | { ok: false; message: string }

export interface EnsureOptions {
	/** Why it is needed, for the log. */
	reason?: string
	/** The developer asked for this (a button): a failure is shown with Retry. Background work stays quiet. */
	interactive?: boolean
	/** Build a new one even if the current one passes (the Repair command). */
	rebuild?: boolean
}

export interface ManagedPythonHost {
	/** Show work that takes a while; `report` sets the line under the title. */
	withProgress<T>(title: string, task: (report: (message: string) => void) => Promise<T>): Promise<T>
	/** Say that the setup failed, with Retry and a way to read the log. */
	notifyFailure(message: string, logFile: string, retry: () => void): void
	/** The editor's `http.proxy`, if one is set. */
	proxy(): string | undefined
	/** This extension's version, written into the build's record. */
	version: string
}

const TITLE = "Adsum IoT Coder: setting up Bluetooth support (one time, about a minute)"
/** A Python that passed its check is trusted for this long in one editor session before it is checked again. */
const TRUST_MS = 30 * 60_000
/** A background attempt that failed is not repeated sooner than this; a button press always tries again. */
const QUIET_RETRY_MS = 5 * 60_000
/** An automatic repair is not repeated sooner than this, so a Python that cannot be fixed never loops. */
const AUTO_REPAIR_MS = 10 * 60_000
const LOCK_WAIT_MS = 12 * 60_000
const LOCK_STALE_MS = 20 * 60_000

class SetupError extends Error {
	constructor(
		readonly kind: "network" | "checksum" | "unpack" | "pip" | "venv" | "check" | "nopython" | "lock",
		message: string,
	) {
		super(message)
	}
}

let host: ManagedPythonHost | undefined
let current: ManagedPythonInfo | null = null
const healthyUntil = new Map<string, number>()
const listeners = new Set<(python: string) => void>()
let inflight: Promise<EnsureResult> | null = null
let lastFailure: { at: number; message: string } | undefined
let lastAutoRepair = 0

/** extension.ts hands in the editor's surfaces; without them the setup still works, silently. */
export function setManagedPythonHost(h: ManagedPythonHost): void {
	host = h
}

/** Called with the Python's path each time a setup or a repair gives a new one. */
export function onManagedPythonReady(listener: (python: string) => void): { dispose(): void } {
	listeners.add(listener)
	return { dispose: () => listeners.delete(listener) }
}

// ── where things live ────────────────────────────────────────────────────────────────────────────────────────────

export function managedPythonRoot(): string {
	const override = process.env.ADSUM_PYTHON_RUNTIME_DIR?.trim()
	if (override) return override
	let base: string | undefined
	try {
		base = HostProvider.get().globalStorageFsPath
	} catch {
		base = undefined
	}
	return path.join(base || path.join(os.homedir(), ".adsum"), "pyrt")
}

export function managedPythonLog(): string {
	return path.join(managedPythonRoot(), "setup.log")
}

function currentFile(): string {
	return path.join(managedPythonRoot(), "current.json")
}

function log(line: string): void {
	Logger.info(`ManagedPython: ${line}`)
	try {
		mkdirSync(managedPythonRoot(), { recursive: true })
		appendFileSync(managedPythonLog(), `${new Date().toISOString()} ${line}\n`)
	} catch {
		// the log is a help, never a reason to fail
	}
}

function rotateLog(): void {
	try {
		const f = managedPythonLog()
		if (existsSync(f) && statSync(f).size > 1 << 20) renameSync(f, `${f}.1`)
	} catch {
		// keep going with the old log
	}
}

function readCurrentFile(): ManagedPythonInfo | null {
	try {
		const j = JSON.parse(readFileSync(currentFile(), "utf8")) as ManagedPythonInfo
		if (j && typeof j.python === "string" && existsSync(j.python)) return j
	} catch {
		// none yet, or damaged: treated as none
	}
	return null
}

/**
 * The Python set up on this computer, or null before the first setup. Synchronous, for the tool resolver; it does
 * not check the Python (ensureManagedPython does), it only says which one was set up and that it is still on disk.
 */
export function managedPythonNow(): string | null {
	if (current && !existsSync(current.python)) current = null
	if (!current) current = readCurrentFile()
	return current?.python ?? null
}

/** Forget that the Python passed its check, so the next use checks it again (and repairs it if it fails). */
export function invalidateManagedPython(): void {
	healthyUntil.clear()
}

// ── running Python ───────────────────────────────────────────────────────────────────────────────────────────────

interface RunResult {
	code: number | null
	stdout: string
	stderr: string
	error?: string
}

/**
 * The environment a tool's Python runs in: the developer's own, minus what would point a Python at another
 * installation (PYTHONHOME, PYTHONPATH, an active virtual environment), with the user-site folder ignored (the
 * launchers' PYTHONNOUSERSITE rule) and UTF-8 output. Windows names are matched without regard to case.
 */
export function toolProcessEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const drop = new Set(["PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP", "PYTHONEXECUTABLE", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__"])
	const env: NodeJS.ProcessEnv = {}
	for (const [k, v] of Object.entries(base)) {
		if (!drop.has(k.toUpperCase())) env[k] = v
	}
	env.PYTHONNOUSERSITE = "1"
	env.PYTHONIOENCODING = "utf-8"
	env.PYTHONUTF8 = "1"
	return env
}

function pipEnv(): NodeJS.ProcessEnv {
	const env = toolProcessEnv()
	const proxy = host?.proxy()?.trim()
	const has = Object.keys(env).some((k) => k.toUpperCase() === "HTTPS_PROXY")
	if (proxy && !has) {
		env.HTTPS_PROXY = proxy
		env.HTTP_PROXY = proxy
	}
	env.PIP_DISABLE_PIP_VERSION_CHECK = "1"
	return env
}

function run(cmd: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv = toolProcessEnv()): Promise<RunResult> {
	return new Promise((resolve) => {
		try {
			execFile(
				cmd,
				args,
				{ timeout: timeoutMs, maxBuffer: 32 << 20, windowsHide: true, env, encoding: "utf8" },
				(err, stdout, stderr) => {
					const code = err
						? typeof (err as { code?: unknown }).code === "number"
							? (err as { code: number }).code
							: null
						: 0
					resolve({
						code,
						stdout: String(stdout ?? ""),
						stderr: String(stderr ?? ""),
						error: err ? err.message : undefined,
					})
				},
			)
		} catch (e) {
			resolve({ code: null, stdout: "", stderr: "", error: e instanceof Error ? e.message : String(e) })
		}
	})
}

function lastLine(text: string): string {
	const lines = text
		.trim()
		.split(/\r?\n/)
		.filter((l) => l.trim())
	return lines[lines.length - 1]?.trim() ?? ""
}

function logRun(what: string, r: RunResult): void {
	const tail = (s: string) => (s.length > 4000 ? `…${s.slice(-4000)}` : s)
	log(`${what}: exit ${r.code}${r.error && r.code !== 0 ? ` (${r.error.split("\n")[0]})` : ""}`)
	if (r.stdout.trim()) log(`  stdout: ${tail(r.stdout.trim())}`)
	if (r.stderr.trim()) log(`  stderr: ${tail(r.stderr.trim())}`)
}

interface Health {
	ok: boolean
	python?: string
	exe?: string
	bleak?: string
	error?: string
}

async function healthCheck(cmd: PythonCommand): Promise<Health> {
	const r = await run(cmd.cmd, [...cmd.args, "-s", "-c", healthCheckCode()], 120_000)
	try {
		const j = JSON.parse(lastLine(r.stdout)) as Health
		if (typeof j.ok === "boolean") return j
	} catch {
		// not our JSON: the Python did not even start
	}
	return { ok: false, error: lastLine(r.stderr) || r.error?.split("\n")[0] || `exit ${r.code}` }
}

const py = (p: string): PythonCommand => ({ cmd: p, args: [] })

// ── the lock: one setup at a time across editor windows ──────────────────────────────────────────────────────────

/** Pure: is a lock left by a process that is gone, or older than any setup takes? Exported for the tests. */
export function lockIsStale(
	owner: { pid?: number; at?: number; host?: string } | null,
	now: number,
	isAlive: (pid: number) => boolean,
): boolean {
	if (!owner || typeof owner.at !== "number") return true
	if (now - owner.at > LOCK_STALE_MS) return true
	if (owner.host && owner.host !== os.hostname()) return false
	return typeof owner.pid === "number" ? !isAlive(owner.pid) : false
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM"
	}
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
	const dir = path.join(managedPythonRoot(), ".lock")
	await fsp.mkdir(managedPythonRoot(), { recursive: true })
	const deadline = Date.now() + LOCK_WAIT_MS
	for (;;) {
		try {
			await fsp.mkdir(dir)
			await fsp.writeFile(
				path.join(dir, "owner.json"),
				JSON.stringify({ pid: process.pid, at: Date.now(), host: os.hostname() }),
			)
			break
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
			let owner: { pid?: number; at?: number; host?: string } | null = null
			try {
				owner = JSON.parse(await fsp.readFile(path.join(dir, "owner.json"), "utf8"))
			} catch {
				// a lock being written right now has no owner file yet: give it a moment
				const age = Date.now() - (await fsp.stat(dir).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
				owner = age > 60_000 ? null : { at: Date.now() }
			}
			if (lockIsStale(owner, Date.now(), pidAlive)) {
				log("an old lock was left by a window that is gone: taking it over")
				await fsp.rm(dir, { recursive: true, force: true })
				continue
			}
			if (Date.now() > deadline) throw new SetupError("lock", "another editor window is still setting up Bluetooth support")
			await sleep(1500)
		}
	}
	try {
		return await fn()
	} finally {
		await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}

async function renameRetry(from: string, to: string): Promise<void> {
	// Windows: an antivirus that is still reading a new file holds it for a moment.
	for (let i = 0; ; i++) {
		try {
			await fsp.rename(from, to)
			return
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code ?? ""
			if (i >= 8 || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw e
			await sleep(250 * (i + 1))
		}
	}
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
	const tmp = `${file}.${process.pid}.tmp`
	await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`)
	await renameRetry(tmp, file)
}

// ── way A: the portable Python ───────────────────────────────────────────────────────────────────────────────────

/** Pure: the words of a failed download or pip run that mean "no network". Exported for the tests. */
export function isNetworkFailure(text: string): boolean {
	return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR|fetch failed|NewConnectionError|getaddrinfo failed|Name or service not known|Temporary failure in name resolution|Failed to establish a new connection|ProxyError|ConnectTimeout|Max retries exceeded|network is unreachable|timed out/i.test(
		text,
	)
}

function describe(e: unknown): string {
	if (e instanceof Error) {
		const cause = (e as { cause?: { code?: string; message?: string } }).cause
		const extra = cause?.code ?? cause?.message
		return extra && !e.message.includes(extra) ? `${e.message} (${extra})` : e.message
	}
	return String(e)
}

async function fileSha256(file: string): Promise<string | null> {
	try {
		return createHash("sha256")
			.update(await fsp.readFile(file))
			.digest("hex")
	} catch {
		return null
	}
}

async function download(url: string, file: string, sha256: string, report: (m: string) => void): Promise<void> {
	if ((await fileSha256(file)) === sha256) {
		log(`download kept from an earlier try: ${file}`)
		return
	}
	let last = ""
	// Three tries with a pause between: a busy or flaky network (github.com timed out from the test PC on 18 Oct
	// 2026) often answers the second or third time. Each try waits up to ten seconds for a connection.
	for (let attempt = 1; attempt <= 3; attempt++) {
		if (attempt > 1) await sleep(attempt === 2 ? 2000 : 5000)
		try {
			report(attempt === 1 ? "Downloading Python" : `Downloading Python, try ${attempt} of 3`)
			log(`download ${url} (try ${attempt})`)
			const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const buf = Buffer.from(await res.arrayBuffer())
			const got = createHash("sha256").update(buf).digest("hex")
			if (got !== sha256) {
				throw new SetupError("checksum", `the Python download does not match its checksum (a proxy may have changed it)`)
			}
			await fsp.mkdir(path.dirname(file), { recursive: true })
			const tmp = `${file}.${process.pid}.part`
			await fsp.writeFile(tmp, buf)
			await renameRetry(tmp, file)
			log(`downloaded ${buf.length} bytes, checksum good`)
			return
		} catch (e) {
			if (e instanceof SetupError) throw e
			last = describe(e)
			log(`download failed: ${last}`)
		}
	}
	let where = url
	try {
		where = new URL(url).host
	} catch {
		// keep the whole address
	}
	throw new SetupError("network", `could not download Python from ${where} (${last})`)
}

function newBuildDir(id: string): string {
	return path.join(managedPythonRoot(), `${id}-${Date.now().toString(36)}`)
}

async function pipInstall(python: string, workDir: string, report: (m: string) => void): Promise<void> {
	const req = path.join(workDir, "adsum-requirements.txt")
	const con = path.join(workDir, "adsum-constraints.txt")
	await fsp.writeFile(req, `${REQUIREMENTS}\n`)
	await fsp.writeFile(con, `${CONSTRAINTS}\n`)
	const args = [
		"-s",
		"-m",
		"pip",
		"install",
		"--disable-pip-version-check",
		"--no-input",
		"--no-warn-script-location",
		"--only-binary=:all:",
		"--progress-bar",
		"off",
		"--cache-dir",
		path.join(managedPythonRoot(), "pip-cache"),
		"-r",
		req,
	]
	report("Installing the Bluetooth library")
	let r = await run(python, [...args, "-c", con], 15 * 60_000, pipEnv())
	logRun("pip install (with the known-good versions)", r)
	if (r.code !== 0 && !isNetworkFailure(r.stderr)) {
		report("Installing the Bluetooth library, second try")
		r = await run(python, args, 15 * 60_000, pipEnv())
		logRun("pip install (the tool's own versions only)", r)
	}
	if (r.code !== 0) {
		const why =
			r.stderr
				.split(/\r?\n/)
				.find((l) => /^ERROR:/.test(l.trim()))
				?.trim() ?? lastLine(r.stderr)
		throw new SetupError(
			isNetworkFailure(r.stderr) ? "network" : "pip",
			isNetworkFailure(r.stderr)
				? "could not reach pypi.org to install the Bluetooth library"
				: `could not install the Bluetooth library (${why || `exit ${r.code}`})`,
		)
	}
}

async function finish(
	dir: string,
	python: string,
	source: PythonSource,
	report: (m: string) => void,
): Promise<ManagedPythonInfo> {
	report("Checking it")
	const h = await healthCheck(py(python))
	if (!h.ok) throw new SetupError("check", `the Bluetooth library does not load (${h.error ?? "no answer"})`)
	const info: ManagedPythonInfo = {
		python,
		source,
		dir,
		at: new Date().toISOString(),
		ext: host?.version,
		pythonVersion: h.python,
		bleak: h.bleak,
	}
	await fsp.writeFile(path.join(dir, "ADSUM-RUNTIME.json"), `${JSON.stringify(info, null, 2)}\n`)
	return info
}

async function wayA(target: RuntimeTarget, report: (m: string) => void): Promise<ManagedPythonInfo> {
	const archive = path.join(managedPythonRoot(), "downloads", pbsAsset(target))
	await download(pbsUrl(target, process.env.ADSUM_PYTHON_RUNTIME_URL), archive, TARGETS[target].sha256, report)
	const dir = newBuildDir(runtimeId(target))
	try {
		report("Unpacking Python")
		const st = await extractTarGz(archive, dir)
		log(`unpacked ${st.files} files, ${st.links} links into ${dir}`)
		const python = interpreterInPortable(dir)
		if (!existsSync(python)) throw new SetupError("unpack", `the unpacked Python has no ${path.basename(python)}`)
		await pipInstall(python, dir, report)
		return await finish(dir, python, "download", report)
	} catch (e) {
		await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
		throw e
	}
}

// ── ways B and C: a Python already on this computer ─────────────────────────────────────────────────────────────

interface Found {
	exe: string
	v: number
	venv: boolean
}

/** Pure: expand `*` folder parts of a candidate path, one level each. Exported for the tests. */
export function expandWildcards(p: string, readdir: (dir: string) => string[], sep: string): string[] {
	if (!p.includes("*")) return [p]
	const parts = p.split(sep)
	let bases = [parts[0] === "" ? sep : parts[0]]
	for (const part of parts.slice(1)) {
		const next: string[] = []
		for (const b of bases) {
			if (part.includes("*")) {
				const re = new RegExp(`^${part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i")
				let names: string[] = []
				try {
					names = readdir(b)
				} catch {
					names = []
				}
				for (const n of names.sort().reverse()) if (re.test(n)) next.push(b.endsWith(sep) ? `${b}${n}` : `${b}${sep}${n}`)
			} else {
				next.push(b.endsWith(sep) ? `${b}${part}` : `${b}${sep}${part}`)
			}
		}
		bases = next
	}
	return bases
}

async function findSystemPythons(report: (m: string) => void): Promise<Found[]> {
	report("Looking for a Python on this computer")
	const sep = process.platform === "win32" ? "\\" : "/"
	const out: Found[] = []
	const seen = new Set<string>()
	for (const c of systemPythonCandidates(process.platform, process.env, os.homedir())) {
		const cmds = path.isAbsolute(c.cmd)
			? expandWildcards(c.cmd, (d) => readdirSync(d), sep)
					.filter((p) => existsSync(p))
					.map((p) => ({ cmd: p, args: c.args }))
			: [c]
		for (const cmd of cmds) {
			const r = await run(cmd.cmd, [...cmd.args, "-c", PROBE_CODE], 20_000)
			let j: { v?: number; exe?: string; venv?: boolean } | null = null
			try {
				j = JSON.parse(lastLine(r.stdout))
			} catch {
				j = null
			}
			if (!j?.exe || typeof j.v !== "number") continue
			const key = process.platform === "win32" ? j.exe.toLowerCase() : j.exe
			if (seen.has(key)) continue
			seen.add(key)
			out.push({ exe: j.exe, v: j.v, venv: !!j.venv })
			log(`found Python ${Math.floor(j.v / 100)}.${j.v % 100} at ${j.exe}${j.venv ? "" : " (no venv module)"}`)
		}
	}
	return out
}

async function wayB(found: Found[], report: (m: string) => void): Promise<ManagedPythonInfo> {
	const usable = found.filter((f) => f.venv && f.v >= MIN_SYSTEM_PY && f.v <= MAX_SYSTEM_PY).slice(0, 2)
	if (!usable.length) throw new SetupError("nopython", "no Python 3.10 to 3.13 on this computer to build from")
	let last: unknown
	for (const f of usable) {
		const dir = newBuildDir(`venv${f.v}-r${RUNTIME_REVISION}`)
		try {
			report(`Making a private copy of Python ${Math.floor(f.v / 100)}.${f.v % 100}`)
			const r = await run(f.exe, ["-s", "-m", "venv", dir], 5 * 60_000)
			logRun(`venv from ${f.exe}`, r)
			if (r.code !== 0)
				throw new SetupError("venv", `could not make a private Python (${lastLine(r.stderr) || `exit ${r.code}`})`)
			const python = interpreterInVenv(dir)
			await pipInstall(python, dir, report)
			return await finish(dir, python, "system-venv", report)
		} catch (e) {
			last = e
			await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
			if (e instanceof SetupError && e.kind === "network") break // the next Python would meet the same network
		}
	}
	throw last
}

async function wayC(found: Found[], report: (m: string) => void): Promise<ManagedPythonInfo> {
	report("Looking for a Python that already has the Bluetooth library")
	for (const f of found) {
		if (f.v < MIN_SYSTEM_PY) continue
		const h = await healthCheck(py(f.exe))
		if (h.ok) {
			log(`using ${f.exe} as it is: it already has the Bluetooth library`)
			return {
				python: f.exe,
				source: "system",
				at: new Date().toISOString(),
				ext: host?.version,
				pythonVersion: h.python,
				bleak: h.bleak,
			}
		}
	}
	throw new SetupError("nopython", "no Python on this computer already has the Bluetooth library")
}

// ── the setup ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Pure: one sentence for a failed setup, from the reasons each way gave. Exported for the tests. */
export function failureWords(reasons: string[]): string {
	const first = reasons[0] ?? "no way to set it up worked"
	const offline = reasons.length > 0 && reasons.some((r) => isNetworkFailure(r) || /could not reach|could not download/.test(r))
	return `Bluetooth support could not be set up on this computer: ${first}.${offline ? " Check the internet connection, then press Scan again." : " Press Scan to try again; the log says more."}`
}

async function provision(report: (m: string) => void, ways: string): Promise<EnsureResult> {
	const target = runtimeTarget()
	const reasons: string[] = []
	const attempt = async (name: string, fn: () => Promise<ManagedPythonInfo>): Promise<ManagedPythonInfo | null> => {
		try {
			return await fn()
		} catch (e) {
			const words = describe(e)
			reasons.push(words)
			log(`way ${name} failed: ${words}`)
			return null
		}
	}
	let info: ManagedPythonInfo | null = null
	if (ways.includes("A")) {
		if (target) info = await attempt("A (a portable Python)", () => wayA(target, report))
		else log(`way A skipped: no portable Python is published for ${process.platform}-${process.arch}`)
	}
	let found: Found[] | null = null
	const pythonsHere = async (): Promise<Found[]> => {
		if (!found) found = await findSystemPythons(report)
		return found
	}
	if (!info && ways.includes("B"))
		info = await attempt("B (a private copy of a Python here)", async () => wayB(await pythonsHere(), report))
	if (!info && ways.includes("C"))
		info = await attempt("C (a Python here, as it is)", async () => wayC(await pythonsHere(), report))
	if (!info) return { ok: false, message: failureWords(reasons) }
	await commit(info)
	return { ok: true, python: info.python, source: info.source }
}

async function commit(info: ManagedPythonInfo): Promise<void> {
	await writeJsonAtomic(currentFile(), info)
	current = info
	healthyUntil.set(info.python, Date.now() + TRUST_MS)
	lastFailure = undefined
	log(`ready: ${info.python} (${info.source}, Python ${info.pythonVersion ?? "?"}, bleak ${info.bleak ?? "?"})`)
	for (const l of listeners) {
		try {
			l(info.python)
		} catch {
			// one listener's fault is not the setup's
		}
	}
	void sweep(info)
}

/** Remove earlier builds and failed leftovers. A build still in use (a running tool on Windows) is left for next time. */
async function sweep(keep: ManagedPythonInfo): Promise<void> {
	try {
		const root = managedPythonRoot()
		const keepName = keep.dir ? path.basename(keep.dir) : ""
		for (const n of await fsp.readdir(root)) {
			if (n !== keepName && /^(py\d+|venv\d+)-/.test(n)) {
				await fsp.rm(path.join(root, n), { recursive: true, force: true }).catch(() => {})
			}
		}
	} catch {
		// housekeeping only
	}
}

const okOf = (i: ManagedPythonInfo): EnsureResult => ({ ok: true, python: i.python, source: i.source })

function fail(opts: EnsureOptions, message: string): EnsureResult {
	lastFailure = { at: Date.now(), message }
	log(`not ready: ${message}`)
	if (opts.interactive) {
		host?.notifyFailure(message, managedPythonLog(), () => {
			void ensureManagedPython({ ...opts, interactive: true })
		})
	}
	return { ok: false, message }
}

/**
 * A Python the tools can run on, checked: the one set up before if it still passes, else a new setup (or a repair).
 * Several callers share one setup. Never throws.
 */
export function ensureManagedPython(opts: EnsureOptions = {}): Promise<EnsureResult> {
	if (!inflight) {
		inflight = ensureOnce(opts)
			.catch((e) => fail(opts, `Bluetooth support could not be set up on this computer: ${describe(e)}`))
			.finally(() => {
				inflight = null
			})
	}
	return inflight
}

async function ensureOnce(opts: EnsureOptions): Promise<EnsureResult> {
	const before = opts.rebuild ? null : readCurrentFile()
	if (before) {
		if ((healthyUntil.get(before.python) ?? 0) > Date.now()) {
			current = before
			return okOf(before)
		}
		const h = await healthCheck(py(before.python))
		if (h.ok) {
			current = before
			healthyUntil.set(before.python, Date.now() + TRUST_MS)
			return okOf(before)
		}
		log(`the Python in use failed its check (${h.error ?? "no answer"}): repairing it`)
		if (Date.now() - lastAutoRepair < AUTO_REPAIR_MS) {
			return fail(
				opts,
				`Bluetooth support is broken on this computer and a repair did not fix it (${h.error ?? "no answer"})`,
			)
		}
		lastAutoRepair = Date.now()
	} else if (!opts.interactive && !opts.rebuild && lastFailure && Date.now() - lastFailure.at < QUIET_RETRY_MS) {
		return { ok: false, message: lastFailure.message }
	}
	const ways = (process.env.ADSUM_PYTHON_SETUP_WAYS || "ABC").toUpperCase()
	const work = (report: (m: string) => void) =>
		withLock(async () => {
			// Another window may have finished a setup while this one waited for the lock.
			if (!opts.rebuild) {
				const again = readCurrentFile()
				if (again && (!before || again.python !== before.python || again.at !== before.at)) {
					const h = await healthCheck(py(again.python))
					if (h.ok) {
						current = again
						healthyUntil.set(again.python, Date.now() + TRUST_MS)
						log(`another window set it up: ${again.python}`)
						return okOf(again)
					}
				}
			}
			rotateLog()
			log(
				`setting up (${opts.reason ?? "no reason given"}${before ? ", a repair" : ""}) on ${process.platform}-${process.arch}, ways ${ways}`,
			)
			return provision(report, ways)
		})
	const result = host ? await host.withProgress(TITLE, work) : await work(() => {})
	return result.ok ? result : fail(opts, result.message)
}

/** The Repair command: a new build even if the current one passes. */
export function repairManagedPython(): Promise<EnsureResult> {
	lastAutoRepair = 0
	healthyUntil.clear()
	return ensureManagedPython({ reason: "the Repair command", interactive: true, rebuild: true })
}
