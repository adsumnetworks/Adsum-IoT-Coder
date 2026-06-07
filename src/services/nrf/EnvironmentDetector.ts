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
let _extensionInfo: { present: boolean; version?: string } = { present: false }
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
export function setNrfExtensionInfo(info: { present: boolean; version?: string }): void {
	_extensionInfo = info
}

/**
 * Resolves the nrfutil binary path. nrfutil is installed by the nRF Connect tooling at
 * ~/.nrfutil/bin/nrfutil and is typically NOT on PATH — and on macOS a GUI-launched VS Code
 * doesn't inherit the login shell PATH anyway. So we check the canonical location first, then
 * fall back to a bare "nrfutil" (resolved via PATH) for non-standard installs.
 */
export function resolveNrfutilCommand(): string {
	const binName = process.platform === "win32" ? "nrfutil.exe" : "nrfutil"
	const candidates = [join(homedir(), ".nrfutil", "bin", binName)]
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate
		}
	}
	return "nrfutil"
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

async function probeSdks(nrfutil: string): Promise<string[]> {
	try {
		const result = await execAsync(`"${nrfutil}" sdk-manager list --json`, { timeout: 8000 })
		return parseSdkList(result.stdout)
	} catch {
		return []
	}
}

async function probeBoards(): Promise<{ nrfutilPresent: boolean; boards: NrfBoard[] }> {
	const nrfutil = resolveNrfutilCommand()
	try {
		const listResult = await execAsync(`"${nrfutil}" device list --json`, { timeout: 8000 })
		const serials = parseDeviceList(listResult.stdout)

		if (serials.length === 0) {
			return { nrfutilPresent: true, boards: [] }
		}

		const boards = await Promise.all(
			serials.map(async (serialNumber) => {
				try {
					const infoResult = await execAsync(`"${nrfutil}" device device-info --serial-number ${serialNumber} --json`, {
						timeout: 8000,
					})
					return { serialNumber, ...parseDeviceInfo(infoResult.stdout) }
				} catch {
					return { serialNumber }
				}
			}),
		)

		return { nrfutilPresent: true, boards }
	} catch {
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

	const nrfutil = resolveNrfutilCommand()
	const projectSdk = detectProjectSdk(_workspaceRoots)
	const [boardsResult, installedSdkVersions] = await Promise.all([
		probeBoards().catch(() => ({ nrfutilPresent: false, boards: [] as NrfBoard[] })),
		probeSdks(nrfutil).catch(() => [] as string[]),
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
