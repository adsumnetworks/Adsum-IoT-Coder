import type { NrfBoard, NrfEnvironment, ProjectSdk } from "@shared/nrf"
import { exec } from "child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"
import { promisify } from "util"
import { telemetryService } from "@/services/telemetry"

export type { NrfBoard, NrfEnvironment, ProjectSdk }

const execAsync = promisify(exec)

const EMPTY_ENV: NrfEnvironment = {
	status: "unknown",
	extensionPresent: false,
	nrfutilPresent: false,
	boards: [],
}

let _cache: NrfEnvironment | undefined
// Extension info is set once at activation from extension.ts (which has vscode in scope).
// Extension install/uninstall always requires a window reload, so this stays fresh.
// `extensionPath` is the nRF Connect extension's install dir — used to locate its
// bundled nrfutil binaries (see resolveNrfutilCommands).
let _extensionInfo: { present: boolean; version?: string; extensionPath?: string } = { present: false }
// Workspace folder paths injected from extension.ts (grit forbids vscode.* here).
let _workspaceRoots: string[] = []

/** Called from extension.ts with the open workspace folder paths (re-set on folder change). */
export function setNrfWorkspaceRoots(roots: string[]): void {
	_workspaceRoots = roots
}

export function getCachedNrfEnvironment(): NrfEnvironment {
	return _cache ?? { ...EMPTY_ENV }
}

export function clearNrfEnvironmentCache(): void {
	_cache = undefined
}

/** Called from extension.ts (plugin-exempt) with the vscode.extensions probe result. */
export function setNrfExtensionInfo(info: { present: boolean; version?: string; extensionPath?: string }): void {
	_extensionInfo = info
}

/** How to invoke nrfutil's `device` and `sdk-manager` commands, already shell-quoted. */
export interface NrfutilCommands {
	/** Command prefix for device ops — append e.g. ` list --json`. */
	devicePrefix: string
	/** Command prefix for sdk-manager ops — append e.g. ` list --json`. */
	sdkManagerPrefix: string
	/** Where the binaries were resolved from (diagnostics/telemetry). */
	source: "launcher" | "extension" | "path-fallback"
}

/**
 * Resolves how to invoke nrfutil. It ships in two layouts:
 *
 *  - **Launcher** — a single `nrfutil` binary that dispatches subcommands, invoked as
 *    `nrfutil device …` / `nrfutil sdk-manager …`. This is the canonical standalone install at
 *    `~/.nrfutil/bin/nrfutil`, which is what macOS/Linux developers typically have.
 *  - **Split per-command binaries** — separate `nrfutil-device` / `nrfutil-sdk-manager`
 *    executables that take the subcommand args directly (`nrfutil-device list …`). This is how the
 *    nRF Connect VS Code extension bundles nrfutil, under `<ext>/platform/nrfutil/bin/`. On a stock
 *    Windows install this is the ONLY nrfutil present — there is no launcher anywhere — which is why
 *    detection previously returned "nrfutil not found" and the home screen showed no boards.
 *
 * Resolution order is deliberately **launcher-first**: if a launcher exists we use it exactly as
 * before, so macOS/Linux behaviour is unchanged. The extension-bundled split binaries are only used
 * when no launcher is found (the Windows case). A bare-command PATH form is the last resort.
 *
 * `existsSyncFn` is injected for unit tests.
 */
export function resolveNrfutilCommands(
	opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string; extensionPath?: string } = {},
	existsSyncFn: (p: string) => boolean = existsSync,
): NrfutilCommands {
	const platform = opts.platform ?? process.platform
	const env = opts.env ?? process.env
	const home = opts.home ?? homedir()
	const isWin = platform === "win32"
	const exe = (base: string): string => (isWin ? `${base}.exe` : base)
	const quote = (p: string): string => `"${p}"`

	// 1. Launcher locations — unchanged from the previous resolver. Keeping these FIRST guarantees
	//    macOS/Linux (and any standalone-launcher Windows install) behave exactly as before.
	const launcherCandidates: string[] = []
	if (env.NRFUTIL_HOME) {
		launcherCandidates.push(join(env.NRFUTIL_HOME, "bin", exe("nrfutil")))
	}
	launcherCandidates.push(join(home, ".nrfutil", "bin", exe("nrfutil")))
	if (isWin) {
		const localAppData = env.LOCALAPPDATA
		const programFiles = env.ProgramFiles
		if (localAppData) {
			launcherCandidates.push(join(localAppData, "Programs", "nrfutil", exe("nrfutil")))
			launcherCandidates.push(join(localAppData, "Nordic Semiconductor", "nrfutil", "bin", exe("nrfutil")))
			launcherCandidates.push(join(localAppData, "nrfutil", "bin", exe("nrfutil")))
		}
		if (programFiles) {
			launcherCandidates.push(join(programFiles, "Nordic Semiconductor", "nrfutil", exe("nrfutil")))
		}
	}
	for (const launcher of launcherCandidates) {
		if (existsSyncFn(launcher)) {
			console.info(`[adsum][nrf] nrfutil launcher resolved to: ${launcher}`)
			return {
				devicePrefix: `${quote(launcher)} device`,
				sdkManagerPrefix: `${quote(launcher)} sdk-manager`,
				source: "launcher",
			}
		}
	}

	// 2. nRF Connect extension-bundled split binaries — the only nrfutil on a stock Windows install.
	//    The layout `<ext>/platform/nrfutil/bin/nrfutil-{device,sdk-manager}` is consistent across
	//    platforms (only the .exe suffix differs), so this also covers macOS/Linux users who have the
	//    extension but no standalone launcher.
	if (opts.extensionPath) {
		const binDir = join(opts.extensionPath, "platform", "nrfutil", "bin")
		const deviceBin = join(binDir, exe("nrfutil-device"))
		const sdkBin = join(binDir, exe("nrfutil-sdk-manager"))
		if (existsSyncFn(deviceBin)) {
			console.info(`[adsum][nrf] nrfutil (nRF Connect extension bundle) resolved at: ${binDir}`)
			return {
				devicePrefix: quote(deviceBin),
				// sdk-manager isn't guaranteed in every extension build; only use the split binary if
				// it's actually there, otherwise fall back to a bare launcher form on PATH.
				sdkManagerPrefix: existsSyncFn(sdkBin) ? quote(sdkBin) : `${exe("nrfutil")} sdk-manager`,
				source: "extension",
			}
		}
	}

	// 3. Last resort — bare command on PATH (launcher form). Works only if nrfutil is on VS Code's
	//    PATH, which on Windows it usually is not — hence the diagnostics above.
	console.info(
		`[adsum][nrf] nrfutil not found at known locations; falling back to PATH. Checked launchers: ${launcherCandidates.join(" | ")}`,
	)
	return {
		devicePrefix: `${exe("nrfutil")} device`,
		sdkManagerPrefix: `${exe("nrfutil")} sdk-manager`,
		source: "path-fallback",
	}
}

/** Parse newline-delimited JSON (nrfutil's --json output is one event object per line). */
function parseJsonLines(stdout: string): Array<Record<string, unknown>> {
	const events: Array<Record<string, unknown>> = []
	for (const line of stdout.split(/\r?\n/)) {
		const trimmed = line.trim()
		if (!trimmed) {
			continue
		}
		try {
			events.push(JSON.parse(trimmed))
		} catch {
			// Non-JSON line (progress text, banners) — skip it.
		}
	}
	return events
}

function devicesFromEvent(ev: any): any[] | undefined {
	if (Array.isArray(ev)) {
		return ev
	}
	if (Array.isArray(ev?.data?.devices)) {
		return ev.data.devices
	}
	if (Array.isArray(ev?.devices)) {
		return ev.devices
	}
	return undefined
}

/**
 * Pure parser for `nrfutil device list --json` stdout. Exported for unit tests.
 * Handles NDJSON (real nrfutil), single-object {devices:[…]}, and a serialNumber text fallback.
 */
export function parseDeviceList(stdout: string): string[] {
	const events = parseJsonLines(stdout)
	let sawDevicesArray = false
	let best: string[] = []
	for (const ev of events) {
		const devices = devicesFromEvent(ev)
		if (devices) {
			sawDevicesArray = true
			const serials = devices.map((d) => d?.serialNumber as string).filter(Boolean)
			if (serials.length > best.length) {
				best = serials
			}
		}
	}
	if (sawDevicesArray) {
		return best
	}
	// No structured devices array found — fall back to scraping serial numbers from text.
	const matches = [...stdout.matchAll(/serial[_\s]?number["':\s]+(\w+)/gi)]
	return matches.map((m) => m[1]).filter(Boolean)
}

interface DeviceListEntry {
	serialNumber: string
	deviceFamily?: string
	boardVersion?: string
	traits?: Record<string, boolean>
}

/**
 * Richer parser for `nrfutil device list --json` stdout that also extracts the Nordic board
 * identity fields (`devkit.deviceFamily`, `devkit.boardVersion`) present in each device entry.
 * This avoids the need to call `device-info` for the panel strip — the devkit object in `list`
 * already tells us the family and PCA board number. Exported for unit tests.
 */
export function parseDeviceListFull(stdout: string): DeviceListEntry[] {
	const events = parseJsonLines(stdout)
	let sawDevicesArray = false
	let best: DeviceListEntry[] = []
	for (const ev of events) {
		const devices = devicesFromEvent(ev)
		if (devices) {
			sawDevicesArray = true
			const entries: DeviceListEntry[] = (devices as any[])
				.filter((d) => d?.serialNumber)
				.map((d: any) => ({
					serialNumber: d.serialNumber as string,
					deviceFamily: d.devkit?.deviceFamily as string | undefined,
					boardVersion: d.devkit?.boardVersion as string | undefined,
					traits: d.traits as Record<string, boolean> | undefined,
				}))
			if (entries.length > best.length) {
				best = entries
			}
		}
	}
	if (sawDevicesArray) {
		return best
	}
	// Text fallback — no devkit fields available, serial only.
	const matches = [...stdout.matchAll(/serial[_\s]?number["':\s]+(\w+)/gi)]
	return matches.map((m) => ({ serialNumber: m[1] })).filter((e) => e.serialNumber)
}

/**
 * Pure parser for `nrfutil device device-info --serial-number <SN> --json` stdout.
 * Exported for unit tests. The rich fields live under data.deviceInfo.jlink.
 */
export function parseDeviceInfo(stdout: string): Partial<NrfBoard> {
	const events = parseJsonLines(stdout)
	for (const ev of events) {
		const e = ev as any
		const jlink =
			e?.data?.deviceInfo?.jlink ?? e?.data?.devices?.[0]?.deviceInfo?.jlink ?? e?.deviceInfo?.jlink ?? e?.device ?? e
		if (jlink && (jlink.deviceName || jlink.device_name || jlink.deviceFamily || jlink.device_family)) {
			return {
				deviceFamily: (jlink.deviceFamily ?? jlink.device_family) as string | undefined,
				deviceName: (jlink.deviceName ?? jlink.device_name) as string | undefined,
				deviceVersion: (jlink.deviceVersion ?? jlink.device_version) as string | undefined,
				boardVersion: (jlink.boardVersion ?? jlink.board_version) as string | undefined,
			}
		}
	}
	// Text fallback for non-JSON output.
	const family = stdout.match(/device[_\s]?family["':\s]+(\S+)/i)?.[1]
	const name = stdout.match(/device[_\s]?name["':\s]+([^\n\r",]+)/i)?.[1]?.trim()
	const version = stdout.match(/device[_\s]?version["':\s]+(\S+)/i)?.[1]
	return { deviceFamily: family, deviceName: name, deviceVersion: version }
}

/**
 * Pure parser for `nrfutil sdk-manager list --json` stdout. Exported for unit tests.
 * Returns installed NCS SDK version strings (e.g. ["v3.2.1"]).
 */
export function parseSdkList(stdout: string): string[] {
	const events = parseJsonLines(stdout)
	for (const ev of events) {
		const e = ev as any
		const versions = e?.data?.versions ?? e?.versions
		if (Array.isArray(versions)) {
			return versions
				.filter((v) => (v?.sdkStatus ?? v?.sdk_status ?? "installed") === "installed")
				.map((v) => v?.version as string)
				.filter(Boolean)
		}
	}
	return []
}

async function probeSdks(sdkManagerPrefix: string): Promise<string[]> {
	try {
		const result = await execAsync(`${sdkManagerPrefix} list --json`, { timeout: 8000 })
		return parseSdkList(result.stdout)
	} catch {
		return []
	}
}

/**
 * A board is a genuine Nordic device only if `device-info` resolved a Nordic chip
 * identity for it (deviceName like "nRF52840", or a deviceFamily). `nrfutil device list`
 * also enumerates non-Nordic USB-serial devices (e.g. an ESP32 dev board), but those
 * never get a Nordic chip identity — they fall through to a bare serial number. Showing
 * those as "boards" leaked ESP devices into the nRF strip, so we drop them here. Exported
 * for unit tests.
 */
export function isNordicBoard(board: Partial<NrfBoard>): boolean {
	return !!(board.deviceName || board.deviceFamily || board.boardVersion)
}

async function probeBoards(devicePrefix: string): Promise<{ nrfutilPresent: boolean; boards: NrfBoard[] }> {
	try {
		const listResult = await execAsync(`${devicePrefix} list --json`, { timeout: 8000 })
		// `list --json` exposes devkit.deviceFamily and devkit.boardVersion directly — no device-info call needed.
		const entries = parseDeviceListFull(listResult.stdout)
		console.info(
			`[adsum][nrf] device list → ${entries.length} device(s): ${entries.map((e) => e.serialNumber).join(", ") || "(none)"}`,
		)

		if (entries.length === 0) {
			console.info(`[adsum][nrf] device list returned no devices; raw head: ${listResult.stdout.slice(0, 300)}`)
			return { nrfutilPresent: true, boards: [] }
		}

		const boards: NrfBoard[] = []
		for (const entry of entries) {
			const board: NrfBoard = {
				serialNumber: entry.serialNumber,
				deviceFamily: entry.deviceFamily,
				boardVersion: entry.boardVersion,
			}
			const kept = isNordicBoard(board)
			console.info(
				`[adsum][nrf] list entry ${entry.serialNumber} → family=${entry.deviceFamily ?? "?"} board=${entry.boardVersion ?? "?"} traits.jlink=${entry.traits?.jlink ?? "?"} ${kept ? "(kept)" : "(DROPPED: no Nordic identity)"}`,
			)
			if (kept) {
				boards.push(board)
			}
		}

		console.info(`[adsum][nrf] boards after Nordic filter: ${boards.length}`)
		return { nrfutilPresent: true, boards }
	} catch (err) {
		// Surface WHY detection failed so Windows "nrfutil not found" can be diagnosed:
		// ENOENT/'is not recognized' = binary not on PATH; a non-zero exit = nrfutil ran but
		// the subcommand failed (e.g. `nrfutil device` not installed).
		const msg = err instanceof Error ? err.message : String(err)
		console.warn(`[adsum][nrf] nrfutil probe failed (cmd="${devicePrefix}"): ${msg}`)
		return { nrfutilPresent: false, boards: [] }
	}
}

// ---------------------------------------------------------------------------
// Project-bound SDK detection (offline file reads only — no `west`, no env).
// ---------------------------------------------------------------------------

/** Extracts NCS_VERSION_STRING from a generated ncs_version.h. Pure; exported for tests. */
export function parseNcsVersionHeader(content: string): string | undefined {
	const m = content.match(/#define\s+NCS_VERSION_STRING\s+"([^"]+)"/)
	return m?.[1] || undefined
}

/** Parses a VERSION file: single-line "3.2.1" (sdk-nrf) or KConfig-style. Pure; exported for tests. */
export function parseVersionFile(content: string): string | undefined {
	const trimmed = content.trim()
	if (/^\d+\.\d+\.\d+/.test(trimmed)) {
		return trimmed.split(/\s/)[0]
	}
	const major = content.match(/VERSION_MAJOR\s*=\s*(\d+)/)?.[1]
	const minor = content.match(/VERSION_MINOR\s*=\s*(\d+)/)?.[1]
	const patch = content.match(/PATCHLEVEL\s*=\s*(\d+)/)?.[1]
	if (major && minor && patch) {
		return `${major}.${minor}.${patch}`
	}
	return undefined
}

/** Extracts the manifest repo path from a .west/config (e.g. "nrf"). Pure; exported for tests. */
export function parseWestManifestPath(content: string): string | undefined {
	const m = content.match(/\[manifest\][^[]*?\bpath\s*=\s*(\S+)/s)
	return m?.[1] || undefined
}

/** Walks up from a directory looking for a `.west` workspace; returns the topdir or undefined. */
function findWestTopdir(start: string): string | undefined {
	let dir = start
	for (let i = 0; i < 12; i++) {
		if (existsSync(join(dir, ".west", "config"))) {
			return dir
		}
		const parent = dirname(dir)
		if (parent === dir) {
			break
		}
		dir = parent
	}
	return undefined
}

/** Newest ncs_version.h within ONE build dir (a sysbuild build has several images, all the same NCS). */
function newestNcsHeaderInDir(start: string): { content: string; mtimeMs: number } | undefined {
	const SKIP = new Set(["node_modules", ".git", ".west"])
	let best: { content: string; mtimeMs: number } | undefined
	const walk = (dir: string, depth: number) => {
		if (depth > 9) {
			return
		}
		let entries: string[]
		try {
			entries = readdirSync(dir)
		} catch {
			return
		}
		for (const entry of entries) {
			const full = join(dir, entry)
			let isDir = false
			try {
				isDir = statSync(full).isDirectory()
			} catch {
				continue
			}
			if (isDir) {
				if (!SKIP.has(entry)) {
					walk(full, depth + 1)
				}
			} else if (entry === "ncs_version.h" && full.includes(join("zephyr", "include", "generated"))) {
				try {
					const mtimeMs = statSync(full).mtimeMs
					if (!best || mtimeMs > best.mtimeMs) {
						best = { content: readFileSync(full, "utf8"), mtimeMs }
					}
				} catch {
					// unreadable — skip
				}
			}
		}
	}
	walk(start, 0)
	return best
}

/**
 * Resolve the project's NCS version header from its build dirs. **Prefers the dir named exactly
 * `build`** — the nRF Connect extension's DEFAULT active build; extra configurations become
 * `build_1/`, `build_2/`, and the active one stays `build/` unless the user explicitly switches. Falls
 * back to the newest-by-mtime across the other build dirs. (Newest-mtime alone was wrong: a more
 * recently-built *non-selected* config — e.g. `build_1` on a different board — would shadow the
 * selected `build/`. Reading the extension's explicitly-selected non-default build needs its API; see
 * roadmap Inc-3. This fixes the default/common case correctly and cross-platform.) Exported for tests.
 */
export function findActiveNcsVersionHeader(root: string): { content: string; mtimeMs: number } | undefined {
	let topEntries: string[]
	try {
		topEntries = readdirSync(root)
	} catch {
		return undefined
	}
	const perDir: { name: string; content: string; mtimeMs: number }[] = []
	for (const entry of topEntries) {
		if (!entry.startsWith("build")) {
			continue
		}
		const full = join(root, entry)
		try {
			if (!statSync(full).isDirectory()) {
				continue
			}
		} catch {
			continue
		}
		const found = newestNcsHeaderInDir(full)
		if (found) {
			perDir.push({ name: entry, ...found })
		}
	}
	if (perDir.length === 0) {
		return undefined
	}
	// Prefer the default active build dir (`build`); else the newest by mtime.
	const chosen = perDir.find((d) => d.name === "build") ?? perDir.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a))
	return { content: chosen.content, mtimeMs: chosen.mtimeMs }
}

/**
 * Resolves the SDK version bound to the open project, offline. Prefers the west manifest pin
 * (authoritative for a workspace app + the artifact migration rewrites); falls back to the build
 * artifact (what was actually compiled — the only signal a freestanding app exposes).
 */
export function detectProjectSdk(roots: string[]): ProjectSdk | undefined {
	for (const root of roots) {
		// Tier 2 — west manifest pin (workspace topology).
		const topdir = findWestTopdir(root)
		if (topdir) {
			try {
				const manifestPath = parseWestManifestPath(readFileSync(join(topdir, ".west", "config"), "utf8"))
				if (manifestPath) {
					const versionFile = join(topdir, manifestPath, "VERSION")
					if (existsSync(versionFile)) {
						const version = parseVersionFile(readFileSync(versionFile, "utf8"))
						if (version) {
							return { version, source: "manifest", topology: "workspace" }
						}
					}
				}
			} catch {
				// fall through to build artifact
			}
		}

		// Tier 1 — build artifact (freestanding or workspace without a readable pin). Prefers the
		// selected/default `build/` dir over a more-recently-built non-selected config (e.g. build_1/).
		const header = findActiveNcsVersionHeader(root)
		if (header) {
			const version = parseNcsVersionHeader(header.content)
			if (version) {
				return { version, source: "build", topology: topdir ? "workspace" : "freestanding" }
			}
		}
	}
	return undefined
}

export async function detectNrfEnvironment(): Promise<NrfEnvironment> {
	_cache = { ...getCachedNrfEnvironment(), status: "detecting" }

	const cmds = resolveNrfutilCommands({ extensionPath: _extensionInfo.extensionPath })
	const projectSdk = detectProjectSdk(_workspaceRoots)
	const [boardsResult, installedSdkVersions] = await Promise.all([
		probeBoards(cmds.devicePrefix).catch(() => ({ nrfutilPresent: false, boards: [] as NrfBoard[] })),
		probeSdks(cmds.sdkManagerPrefix).catch(() => [] as string[]),
	])

	_cache = {
		status: "ready",
		extensionPresent: _extensionInfo.present,
		extensionVersion: _extensionInfo.version,
		nrfutilPresent: boardsResult.nrfutilPresent,
		installedSdkVersions,
		projectSdk,
		boards: boardsResult.boards,
		lastDetectedAt: Date.now(),
	}

	telemetryService.captureNrfEnvDetected({
		extensionPresent: _cache.extensionPresent,
		nrfutilPresent: _cache.nrfutilPresent,
		boardCount: _cache.boards.length,
	})

	return _cache
}
