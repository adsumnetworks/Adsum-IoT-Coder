/**
 * ESP-IDF environment detector — mirrors src/services/nrf/EnvironmentDetector.ts.
 *
 * Passive detection only (no chip reset). Gives the home strip:
 *   🖥 Espressif IDF ext v1.9  ·  📦 ESP-IDF v5.3  ·  🔌 1 ESP32-family  ↺
 *
 * Three detection steps, all pure-filesystem or short subprocess:
 *   1. IDF path  — Espressif extension setting → IDF_PATH env → well-known dirs (reuses idfEnvResolver).
 *   2. IDF version — {idfPath}/version.txt (ships on every release).
 *   3. Devices — pyserial list_ports filtered by known ESP32-family USB VID/PIDs (no chip reset).
 *
 * VID/PID filter:
 *   INCLUDE: 0x303A Espressif native USB · 0x10C4 CP210x · 0x1A86 CH340 · 0x0403 FTDI
 *   EXCLUDE: 0x1366 SEGGER J-Link (nRF DK VCOM — stop cross-platform confusion)
 *
 * Extension info (present/version) is injected from extension.ts (vscode.extensions is banned here).
 */

import { telemetryService } from "@services/telemetry"
import { dedupeEspDevicesByMac, type EspDevice, type EspEnvironment, isMacShaped } from "@shared/esp"
import { exec } from "child_process"
import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { promisify } from "util"
import {
	enumerateIdfInstalls,
	parseIdfVersionCmake,
	resolveIdfPath,
} from "../../hosts/vscode/hostbridge/workspace/idfEnvResolver"
import { classifyWorkspace } from "../platform/WorkspaceClassifier"
import { type ChipResult, getIdfPython, probeChip } from "./espChipProbe"

export type { EspDevice, EspEnvironment }

const execAsync = promisify(exec)

const EMPTY_ESP: EspEnvironment = {
	status: "unknown",
	extensionPresent: false,
	idfPresent: false,
	projectDetected: false,
	espDevices: [],
}

let _cache: EspEnvironment | undefined
let _extensionInfo: { present: boolean; version?: string } = { present: false }
let _workspaceRoots: string[] = []
/** Explicit IDF path from the Espressif extension's `idf.espIdfPath` setting, injected from extension.ts. */
let _idfPathHint: string | undefined
/** Resolved chip per board serial — avoids re-resetting a board we already identified. Cleared on manual refresh. */
const _chipCache = new Map<string, ChipResult>()

/** Called from extension.ts with the Espressif extension probe result. */
export function setEspExtensionInfo(info: { present: boolean; version?: string }): void {
	_extensionInfo = info
}

/**
 * Called from extension.ts with the Espressif extension's configured IDF path
 * (`idf.espIdfPath` / `idf.espIdfPathWin`). This is how most users install ESP-IDF —
 * to a custom path the extension records — so without it the detector misses the toolchain.
 * vscode.* config reads are banned in this file, hence the injection.
 */
export function setEspIdfPathHint(idfPath: string | undefined): void {
	_idfPathHint = idfPath
}

/** Called from extension.ts with open workspace folder paths. */
export function setEspWorkspaceRoots(roots: string[]): void {
	_workspaceRoots = roots
}

export function getCachedEspEnvironment(): EspEnvironment {
	return _cache ?? { ...EMPTY_ESP }
}

export function clearEspEnvironmentCache(): void {
	_cache = undefined
	// A manual refresh should re-probe the chips (a fresh reset), so drop the chip cache too.
	_chipCache.clear()
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Parse {idfPath}/version.txt → version string. Pure; exported for tests. */
export function parseIdfVersionFile(content: string): string | undefined {
	const trimmed = content.trim()
	if (!trimmed) return undefined
	// Typical content: "v5.3.2" or "5.3.2" — accept with or without leading 'v'
	const m = trimmed.match(/^v?(\d+\.\d+[.\d]*)/)
	return m ? (trimmed.startsWith("v") ? trimmed.split(/\s/)[0] : `v${m[1]}`) : undefined
}

/**
 * Parse build/project_description.json for the idf_version field. Pure; exported
 * for tests. NOTE: most ESP-IDF versions do NOT write an idf_version here (the
 * file's "version" is its own format version, "project_version" is the app's git
 * describe) — the reliable project IDF version comes from dependencies.lock; this
 * stays as a forward-compatible fallback for IDF releases that do record it.
 */
export function parseProjectDescription(content: string): string | undefined {
	try {
		const obj = JSON.parse(content) as Record<string, unknown>
		const v = obj["idf_version"]
		if (typeof v === "string" && v) return v
	} catch {
		// ignore malformed JSON
	}
	return undefined
}

/**
 * Parse the project-bound ESP-IDF version from a dependencies.lock (the IDF
 * Component Manager lock file). The resolved version lives under the top-level
 * `idf:` dependency:
 *
 *   dependencies:
 *     idf:
 *       source:
 *         type: idf
 *       version: 5.5.2
 *
 * It is written whenever the project's components are resolved (set-target /
 * reconfigure / build) — even if a full build never completed — so it is the
 * reliable project-bound IDF version (the ESP analogue of nRF's manifest version).
 * Pure; exported for tests.
 */
export function parseDependenciesLockIdfVersion(content: string): string | undefined {
	const lines = content.split(/\r?\n/)
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^(\s*)idf:\s*$/)
		if (!m) continue
		const baseIndent = m[1].length
		// Scan the more-indented block that belongs to this `idf:` key.
		for (let j = i + 1; j < lines.length; j++) {
			const line = lines[j]
			if (line.trim() === "") continue
			const indent = line.length - line.trimStart().length
			if (indent <= baseIndent) break // dedent → left the idf block
			const vm = line.match(/^\s*version:\s*['"]?([^'"\s#]+)/)
			if (vm) return vm[1]
		}
	}
	return undefined
}

/** Known ESP32-family USB VID/PIDs used for passive serial port detection. */
export const ESP_FAMILY_VIDS = new Set([
	0x303a, // Espressif Systems — native USB on ESP32-S2/S3/C3/C6/H2
	0x10c4, // Silicon Labs CP210x — most common on dev boards
	0x1a86, // QinHeng CH340/CH341 — cheap ESP32 boards
	0x0403, // FTDI FT232 — some ESP32 boards
])

/** SEGGER J-Link VID — nRF DK VCOMs. Excluded so nRF boards never show as ESP devices. */
const NRF_SEGGER_VID = 0x1366

export interface RawPortData {
	device: string
	vid?: number | null
	pid?: number | null
	description?: string | null
	serial_number?: string | null
}

/**
 * macOS exposes a few non-device serial ports (Bluetooth, Wi-Fi debug, debug
 * console). esptool skips these by name; mirror that so they never count as ESP.
 */
const MACOS_PORT_BLOCKLIST = ["Bluetooth-Incoming-Port", "wlan-debug", "cu.debug-console"]

/**
 * Filter raw pyserial port list → EspDevice[]. Pure; exported for tests.
 * Keeps ports whose VID is in the ESP family set and is NOT the SEGGER VID.
 * Ports with no VID (null/undefined) are excluded — too ambiguous for the passive strip.
 */
export function filterEspPorts(ports: RawPortData[]): EspDevice[] {
	const result: EspDevice[] = []
	for (const p of ports) {
		if (MACOS_PORT_BLOCKLIST.some((b) => p.device.endsWith(b))) continue
		if (p.vid == null) continue
		const vid = typeof p.vid === "string" ? parseInt(p.vid as string, 16) : p.vid
		if (vid === NRF_SEGGER_VID) continue
		if (!ESP_FAMILY_VIDS.has(vid)) continue
		result.push({
			port: p.device,
			vid,
			pid: p.pid ?? undefined,
			description: p.description ?? undefined,
			serialNumber: p.serial_number ?? undefined,
		})
	}
	return result
}

// ---------------------------------------------------------------------------
// Subprocess probes
// ---------------------------------------------------------------------------

/**
 * Read IDF version from {idfPath}/version.txt (release tarballs / EIM installs), falling back to
 * {idfPath}/tools/cmake/version.cmake (always present — covers git-clone installs that ship no
 * version.txt, so they no longer show a blank version in the env strip).
 */
function readIdfVersion(idfPath: string): string | undefined {
	const versionFile = join(idfPath, "version.txt")
	if (existsSync(versionFile)) {
		try {
			const v = parseIdfVersionFile(readFileSync(versionFile, "utf8"))
			if (v) return v
		} catch {
			// fall through to version.cmake
		}
	}
	const cmakeFile = join(idfPath, "tools", "cmake", "version.cmake")
	if (existsSync(cmakeFile)) {
		try {
			return parseIdfVersionCmake(readFileSync(cmakeFile, "utf8"))
		} catch {
			return undefined
		}
	}
	return undefined
}

export interface EspBuildInfo {
	/** A build descriptor exists somewhere under the roots (the project IS built). */
	built: boolean
	/** IDF version from project_description.json, when the descriptor records it. */
	idfVersion?: string
}

/**
 * Recognize an ESP-IDF build by its FILE (`<buildDir>/project_description.json`),
 * not by assuming the build folder is named `build/`. ESP-IDF lets the build dir
 * be any name (`idf.py -B <dir>`, the VS Code extension's `idf.buildPath`), so we
 * scan each root's direct subfolders. "built" is independent of "version": a build
 * with an unreadable / version-less descriptor is still a build. Exported for tests.
 */
export function readEspBuildInfo(roots: string[]): EspBuildInfo {
	for (const root of roots) {
		let entries: string[]
		try {
			entries = readdirSync(root)
		} catch {
			continue
		}
		for (const entry of entries) {
			const p = join(root, entry, "project_description.json")
			if (!existsSync(p)) continue
			try {
				return { built: true, idfVersion: parseProjectDescription(readFileSync(p, "utf8")) }
			} catch {
				// A build descriptor exists but is unreadable — still a build.
				return { built: true }
			}
		}
	}
	return { built: false }
}

/**
 * Read the project-bound IDF version from the first dependencies.lock found at a
 * root or one of its direct subfolders (the lock sits at the project root, beside
 * the build dir; the subfolder scan covers a nested app in a multi-root workspace).
 * Exported for tests.
 */
export function readProjectIdfVersionFromLock(roots: string[]): string | undefined {
	for (const root of roots) {
		const candidates = [root]
		try {
			for (const entry of readdirSync(root)) candidates.push(join(root, entry))
		} catch {
			// unreadable root — fall through to next
		}
		for (const dir of candidates) {
			const p = join(dir, "dependencies.lock")
			if (!existsSync(p)) continue
			try {
				const v = parseDependenciesLockIdfVersion(readFileSync(p, "utf8"))
				if (v) return v
			} catch {
				// try next candidate
			}
		}
	}
	return undefined
}

/**
 * Enumerate serial ports via pyserial and keep the ESP-family ones. Passive —
 * never resets the device. pyserial ships with esptool in the IDF python env,
 * so we try that interpreter first (always present when IDF is installed), then
 * fall back to the system python. Returns [] when no python has pyserial.
 */
async function probeEspDevices(): Promise<EspDevice[]> {
	const script = [
		"from serial.tools.list_ports import comports",
		"import json",
		"print(json.dumps([{'device':p.device,'vid':p.vid,'pid':p.pid,'description':p.description,'serial_number':p.serial_number} for p in comports()]))",
	].join(";")

	const idfPython = getIdfPython()
	const interpreters = [...(idfPython ? [`"${idfPython}"`] : []), "python3", "python"]
	for (const bin of interpreters) {
		try {
			const { stdout } = await execAsync(`${bin} -c "${script}"`, { timeout: 6000 })
			const parsed = JSON.parse(stdout.trim()) as RawPortData[]
			return filterEspPorts(parsed)
		} catch {
			// try next interpreter or return empty
		}
	}
	return []
}

/**
 * Resolve the exact chip for each ESP device (ESP32-S3 / C6 / …) via esptool.
 * This RESETS each board. Cached per serial so a board already identified isn't
 * reset again on routine re-detects — only a manual refresh (which clears the
 * cache) re-probes. Needs the IDF python; without it the chip stays unresolved
 * and the strip shows "ESP32-family".
 */
async function resolveEspChips(devices: EspDevice[]): Promise<void> {
	if (devices.length === 0) return
	const idfPython = getIdfPython()
	if (!idfPython) {
		// The exact-chip probe needs the IDF python (it ships esptool). Without it the strip can only
		// show the passive "ESP32-family" label, and the board is never reset. Make the cause visible.
		console.info(
			`[esp-detect] chip unresolved — no IDF python found (looked under idf.toolsPath / $IDF_TOOLS_PATH / ~/.espressif/python_env). ` +
				`The device shows its unresolved label — install ESP-IDF tools or set idf.toolsPath to resolve the exact chip.`,
		)
		return
	}

	await Promise.all(
		devices.map(async (d) => {
			const key = d.serialNumber || d.port
			const cached = _chipCache.get(key)
			if (cached) {
				d.chip = cached.chip
				d.chipRevision = cached.chipRevision
				d.mac = cached.mac
				return
			}
			const result = await probeChip(idfPython, d.port)
			if (result.chip) {
				_chipCache.set(key, result)
				d.chip = result.chip
				d.chipRevision = result.chipRevision
				d.mac = result.mac
			} else {
				console.info(
					`[esp-detect] esptool found no chip on ${d.port} — staying unresolved (port busy? board not in download mode?)`,
				)
			}
		}),
	)
}

// ---------------------------------------------------------------------------
// Public detector
// ---------------------------------------------------------------------------

export async function detectEspEnvironment(): Promise<EspEnvironment> {
	_cache = { ...getCachedEspEnvironment(), status: "detecting" }

	// Read Espressif extension setting for explicit IDF path (Tier 1 hint).
	// We can't call vscode.* here but extension.ts already injected _extensionInfo.
	// For the path, we rely on idfEnvResolver which reads process.env and known dirs.
	const platform = (process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux") as
		| "win32"
		| "darwin"
		| "linux"

	// Resolve IDF path: extension setting hint (Tier 1) → IDF_PATH env → well-known dirs.
	// Use the same multi-install enumeration the terminal launcher uses (globs the
	// versioned container dirs like C:\esp\<ver>\esp-idf), then fall back to the
	// first-match resolver for odd layouts the globber misses — so the strip and the
	// terminal never disagree about whether ESP-IDF is installed.
	const listDir = (p: string): string[] => {
		try {
			return readdirSync(p)
		} catch {
			return []
		}
	}
	const installs = enumerateIdfInstalls(platform, process.env, existsSync, listDir, readIdfVersion, _idfPathHint)
	const idfPath = installs[0]?.path ?? resolveIdfPath(platform, process.env, existsSync, _idfPathHint)

	const idfPresent = !!idfPath
	const idfVersion = idfPath ? readIdfVersion(idfPath) : undefined
	// Every install's version (de-duped) so the strip lists ALL of them, not just installs[0] —
	// otherwise it asserts one active version while a build with several installed asks which to use.
	const installedVersions = Array.from(new Set(installs.map((i) => i.version).filter((v): v is string => !!v)))
	// Project IDF version: dependencies.lock is the reliable source (present once
	// components resolve, even without a completed build); the build descriptor's
	// idf_version is only a forward-compatible fallback. "built" is independent.
	const buildInfo = readEspBuildInfo(_workspaceRoots)
	const projectBuilt = buildInfo.built
	const projectIdfVersion = readProjectIdfVersionFromLock(_workspaceRoots) ?? buildInfo.idfVersion

	// An open ESP-IDF project triggers the strip even with no toolchain installed
	// (mirrors the always-visible nRF strip — honest "not detected" beats showing nothing).
	const projectDetected = classifyWorkspace(_workspaceRoots).apps.some((a) => a.platform === "esp")

	const rawDevices = await probeEspDevices().catch(() => [])
	// Resolve the exact chip (S3/C6/…) via esptool — resets the board, cached per serial.
	await resolveEspChips(rawDevices).catch(() => {})
	// A native-USB port (VID 0x303a) reports the chip's base MAC as its USB serial — capture it passively so the
	// dedupe below can fold a board's two USB interfaces (UART bridge + native USB-JTAG) into one entry.
	for (const d of rawDevices) {
		if (!d.mac && isMacShaped(d.serialNumber)) {
			d.mac = d.serialNumber
		}
	}
	// One physical board can expose two USB serial devices (bridge + native) that share the chip's base MAC.
	// Collapse them so a board never shows twice (e.g. "ESP32-C6" + a phantom "ESP (model unknown)"). No-op for
	// single-interface boards (the common case), so it can't regress the Windows/Linux behaviour.
	const espDevices = dedupeEspDevicesByMac(rawDevices)

	_cache = {
		status: "ready",
		extensionPresent: _extensionInfo.present,
		extensionVersion: _extensionInfo.version,
		idfPresent,
		idfPath: idfPath ?? undefined,
		idfVersion,
		installedVersions,
		projectBuilt,
		projectIdfVersion,
		projectDetected,
		espDevices,
		lastDetectedAt: Date.now(),
	}

	telemetryService.captureEspEnvDetected({
		extensionPresent: _cache.extensionPresent,
		idfPresent: _cache.idfPresent,
		deviceCount: _cache.espDevices.length,
	})

	return _cache
}
