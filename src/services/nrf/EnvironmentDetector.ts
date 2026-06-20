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
	/** Where `devicePrefix` was resolved from (diagnostics/telemetry; also drives `binDir`/`nrfutilPath`). */
	source: "launcher" | "extension" | "path-fallback"
	/**
	 * Where `sdkManagerPrefix` specifically was resolved from. Tracked SEPARATELY from `source`
	 * because `device` and `sdk-manager` are independently-installed nrfutil plugins — a real,
	 * confirmed case: a launcher install can have `device` installed (works) but NOT `sdk-manager`
	 * (errors "Subcommand nrfutil-sdk-manager not found"), even though the launcher binary itself
	 * exists. Use this (not `source`) to decide whether sdk-manager calls will actually work.
	 */
	sdkManagerSource: "launcher" | "extension" | "path-fallback"
	/**
	 * Absolute directory containing the resolved nrfutil binary, when known
	 * (launcher dir or the extension's bin dir). Undefined for the PATH fallback.
	 * Used to prepend nrfutil to PATH in our own terminal so the logger wrappers
	 * (which shell out to `nrfutil device …`) work without the nRF terminal.
	 */
	binDir?: string
	/** Absolute path to the resolved nrfutil binary, when known (for ADSUM_NRFUTIL). */
	nrfutilPath?: string
}

/**
 * Resolves how to invoke nrfutil's `device` and `sdk-manager` commands — INDEPENDENTLY, because in
 * practice they are separately-installed nrfutil plugins, not a single bundle. nrfutil ships in two
 * layouts:
 *
 *  - **Launcher** — a single `nrfutil` binary that dispatches to per-command plugin binaries it finds
 *    alongside itself (`<launcherDir>/nrfutil-device`, `<launcherDir>/nrfutil-sdk-manager`, …), invoked
 *    as `nrfutil device …` / `nrfutil sdk-manager …`. This is the canonical standalone install at
 *    `~/.nrfutil/bin/nrfutil`. CONFIRMED IN THE FIELD: a dev machine had the launcher AND its `device`
 *    plugin installed (`~/.nrfutil/bin/nrfutil-device` present, `nrfutil device …` works), but NOT its
 *    `sdk-manager` plugin (`~/.nrfutil/bin/nrfutil-sdk-manager` absent) — running `nrfutil sdk-manager
 *    list` on that box fails with "Subcommand nrfutil-sdk-manager not found", which silently looked
 *    like "no NCS installed" even though two NCS versions were on disk. So a launcher's existence does
 *    NOT guarantee every subcommand works; we check each plugin's presence independently.
 *  - **Split per-command binaries** — separate `nrfutil-device` / `nrfutil-sdk-manager` executables
 *    that take the subcommand args directly (`nrfutil-device list …`). This is how the nRF Connect VS
 *    Code extension bundles nrfutil, under `<ext>/platform/nrfutil/bin/`. On a stock Windows install
 *    this is the only nrfutil present; but it's also a valid SOURCE FOR AN INDIVIDUAL SUBCOMMAND even
 *    on macOS/Linux when the launcher's own plugin for that subcommand is missing (the case above).
 *
 * Resolution per subcommand: launcher (if its own plugin file is present) → extension bundle (if that
 * binary is present) → bare PATH form. `devicePrefix`'s resolution also drives `binDir`/`nrfutilPath`
 * (used to put nrfutil on PATH in our terminal for bare `nrfutil device …` calls) — unchanged behavior
 * from before, since `device` is the common case and rarely the one missing.
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

	// 1. Find the launcher (unchanged search order from before).
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
	let launcher: string | undefined
	for (const candidate of launcherCandidates) {
		if (existsSyncFn(candidate)) {
			launcher = candidate
			break
		}
	}
	if (launcher) {
		console.info(`[adsum][nrf] nrfutil launcher resolved to: ${launcher}`)
	} else {
		console.info(`[adsum][nrf] no nrfutil launcher found. Checked: ${launcherCandidates.join(" | ")}`)
	}

	// 2. Find the extension-bundled split binaries, if any (per-subcommand presence).
	let extDeviceBin: string | undefined
	let extSdkBin: string | undefined
	if (opts.extensionPath) {
		const extBinDir = join(opts.extensionPath, "platform", "nrfutil", "bin")
		const deviceCandidate = join(extBinDir, exe("nrfutil-device"))
		const sdkCandidate = join(extBinDir, exe("nrfutil-sdk-manager"))
		if (existsSyncFn(deviceCandidate)) extDeviceBin = deviceCandidate
		if (existsSyncFn(sdkCandidate)) extSdkBin = sdkCandidate
	}

	// 3. Resolve "device": launcher ALWAYS wins when it exists — unchanged from before. The `device`
	//    plugin is near-universal (installed by the extension's own first run), so we deliberately do
	//    NOT add a plugin-existence check here: that would risk silently flipping the already-working
	//    macOS/Linux path on a false negative. Only "sdk-manager" below gets the stricter check, because
	//    that's the one CONFIRMED to go missing while the launcher itself is present.
	let devicePrefix: string
	let deviceSource: NrfutilCommands["source"]
	if (launcher) {
		devicePrefix = `${quote(launcher)} device`
		deviceSource = "launcher"
	} else if (extDeviceBin) {
		devicePrefix = quote(extDeviceBin)
		deviceSource = "extension"
	} else {
		devicePrefix = `${exe("nrfutil")} device`
		deviceSource = "path-fallback"
	}

	// 4. Resolve "sdk-manager" — INDEPENDENTLY of device. Same priority, but falls through to the
	//    extension bundle (or PATH) when the launcher exists yet its sdk-manager plugin doesn't.
	let sdkManagerPrefix: string
	let sdkManagerSource: NrfutilCommands["source"]
	const launcherSdkBin = launcher ? join(dirname(launcher), exe("nrfutil-sdk-manager")) : undefined
	if (launcher && launcherSdkBin && existsSyncFn(launcherSdkBin)) {
		sdkManagerPrefix = `${quote(launcher)} sdk-manager`
		sdkManagerSource = "launcher"
	} else if (extSdkBin) {
		sdkManagerPrefix = quote(extSdkBin)
		sdkManagerSource = "extension"
		if (launcher) {
			console.info(
				`[adsum][nrf] launcher found at ${launcher} but its sdk-manager plugin is missing — using the nRF Connect extension's bundled nrfutil-sdk-manager instead`,
			)
		}
	} else if (launcher) {
		// Best-effort: still try the launcher form even though we can't confirm the plugin exists —
		// but mark the source as path-fallback so callers know sdk-manager may not actually work.
		sdkManagerPrefix = `${quote(launcher)} sdk-manager`
		sdkManagerSource = "path-fallback"
	} else {
		sdkManagerPrefix = `${exe("nrfutil")} sdk-manager`
		sdkManagerSource = "path-fallback"
	}

	// binDir/nrfutilPath follow the DEVICE resolution — that's what bare `nrfutil device …`/`nrfutil
	// device reset` calls (typed literally by the agent and the logger wrappers) need on PATH.
	let binDir: string | undefined
	let nrfutilPath: string | undefined
	if (deviceSource === "launcher" && launcher) {
		binDir = dirname(launcher)
		nrfutilPath = launcher
	} else if (deviceSource === "extension" && extDeviceBin) {
		binDir = dirname(extDeviceBin)
		nrfutilPath = extDeviceBin
	}

	return { devicePrefix, sdkManagerPrefix, source: deviceSource, sdkManagerSource, binDir, nrfutilPath }
}

/**
 * Convenience over {@link resolveNrfutilCommands} that uses the nRF Connect
 * extension path captured at activation, so callers outside this module (e.g. the
 * host bridge building our own terminal) don't need to thread `extensionPath`.
 */
export function getResolvedNrfutil(): NrfutilCommands {
	return resolveNrfutilCommands({ extensionPath: _extensionInfo.extensionPath })
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

/**
 * Pure parser for `nrfutil sdk-manager list --json` stdout that extracts each installed
 * version's SDK root install directory (the `dirNames` field, e.g. `["/home/user/ncs/v3.3.1"]`).
 * Keyed by NORMALIZED version (no leading "v"), to match {@link selectNcsInstall}'s resolved
 * version format directly — no re-normalization needed at the lookup site.
 *
 * This is what makes `ZEPHYR_BASE` (`<installDir>/zephyr`) derivable for a resolved NCS version:
 * `west` extension commands (`build`, `flash`, …) are only available when west can locate the
 * workspace — either by running with cwd inside it, or via `ZEPHYR_BASE` set as an environment
 * variable (CONFIRMED against Nordic's own troubleshooting docs and tested end-to-end: a `-z
 * ZEPHYR_BASE` CLI flag does NOT work for this, the env var is required). Exported for unit tests.
 */
export function parseSdkInstallPaths(stdout: string): Record<string, string> {
	const events = parseJsonLines(stdout)
	const paths: Record<string, string> = {}
	for (const ev of events) {
		const e = ev as any
		const versions = e?.data?.versions ?? e?.versions
		if (!Array.isArray(versions)) continue
		for (const v of versions) {
			if ((v?.sdkStatus ?? v?.sdk_status ?? "installed") !== "installed") continue
			const version = v?.version as string | undefined
			const dirName = Array.isArray(v?.dirNames) ? (v.dirNames[0] as string | undefined) : undefined
			if (version && dirName) {
				paths[version.replace(/^v/i, "")] = dirName
			}
		}
		return paths
	}
	return paths
}

interface SdkProbeResult {
	versions: string[]
	/** Normalized version (no "v") → NCS SDK root install dir. */
	paths: Record<string, string>
}

async function probeSdks(sdkManagerPrefix: string): Promise<SdkProbeResult> {
	try {
		const result = await execAsync(`${sdkManagerPrefix} list --json`, { timeout: 8000 })
		const versions = parseSdkList(result.stdout)
		// Diagnostic: when the parse yields nothing, log the raw head so we can see whether sdk-manager
		// returned an unexpected shape, an error, or simply isn't the right command family on this host.
		if (versions.length === 0) {
			const head = (result.stdout || result.stderr || "").slice(0, 600).replace(/\s+/g, " ").trim()
			console.info(
				`[adsum][nrf] sdk-manager list returned no parseable versions. Prefix="${sdkManagerPrefix}". Raw head: ${head || "(empty)"}`,
			)
		} else {
			console.info(`[adsum][nrf] sdk-manager list → ${versions.join(", ")}`)
		}
		return { versions, paths: parseSdkInstallPaths(result.stdout) }
	} catch (e) {
		console.info(
			`[adsum][nrf] sdk-manager list failed for prefix "${sdkManagerPrefix}": ${e instanceof Error ? e.message : e}`,
		)
		return { versions: [], paths: {} }
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

/** Bounded recursive search for the newest ncs_version.h under build* dirs. Returns its content + mtime. */
function findNewestNcsVersionHeader(root: string): { content: string; mtimeMs: number } | undefined {
	let best: { content: string; mtimeMs: number } | undefined
	const SKIP = new Set(["node_modules", ".git", ".west"])

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
				if (SKIP.has(entry)) {
					continue
				}
				walk(full, depth + 1)
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

	// Only descend into build* dirs to keep the scan cheap.
	let topEntries: string[]
	try {
		topEntries = readdirSync(root)
	} catch {
		return undefined
	}
	for (const entry of topEntries) {
		if (!entry.startsWith("build")) {
			continue
		}
		const full = join(root, entry)
		try {
			if (statSync(full).isDirectory()) {
				walk(full, 0)
			}
		} catch {
			// skip
		}
	}
	return best
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

		// Tier 1 — build artifact (freestanding or workspace without a readable pin).
		const header = findNewestNcsVersionHeader(root)
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
	const [boardsResult, sdkResult] = await Promise.all([
		probeBoards(cmds.devicePrefix).catch(() => ({ nrfutilPresent: false, boards: [] as NrfBoard[] })),
		probeSdks(cmds.sdkManagerPrefix).catch(() => ({ versions: [], paths: {} }) as SdkProbeResult),
	])

	_cache = {
		status: "ready",
		extensionPresent: _extensionInfo.present,
		extensionVersion: _extensionInfo.version,
		nrfutilPresent: boardsResult.nrfutilPresent,
		installedSdkVersions: sdkResult.versions,
		installedSdkPaths: sdkResult.paths,
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
