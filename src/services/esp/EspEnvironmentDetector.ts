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

import type { EspDevice, EspEnvironment } from "@shared/esp"
import { exec } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { promisify } from "util"
import { resolveIdfPath } from "../../hosts/vscode/hostbridge/workspace/idfEnvResolver"
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

/** Parse build/project_description.json for the idf_version field. Pure; exported for tests. */
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

/** Read IDF version from {idfPath}/version.txt (ship on every IDF release). */
function readIdfVersion(idfPath: string): string | undefined {
	const versionFile = join(idfPath, "version.txt")
	if (!existsSync(versionFile)) return undefined
	try {
		return parseIdfVersionFile(readFileSync(versionFile, "utf8"))
	} catch {
		return undefined
	}
}

/** Find the first build/project_description.json under the workspace roots. */
function readProjectIdfVersion(roots: string[]): string | undefined {
	for (const root of roots) {
		const p = join(root, "build", "project_description.json")
		if (existsSync(p)) {
			try {
				return parseProjectDescription(readFileSync(p, "utf8"))
			} catch {
				// try next root
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
	if (!idfPython) return

	await Promise.all(
		devices.map(async (d) => {
			const key = d.serialNumber || d.port
			const cached = _chipCache.get(key)
			if (cached) {
				d.chip = cached.chip
				d.chipRevision = cached.chipRevision
				return
			}
			const result = await probeChip(idfPython, d.port)
			if (result.chip) {
				_chipCache.set(key, result)
				d.chip = result.chip
				d.chipRevision = result.chipRevision
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
	const idfPath = resolveIdfPath(platform, process.env, existsSync, _idfPathHint)

	const idfPresent = !!idfPath
	const idfVersion = idfPath ? readIdfVersion(idfPath) : undefined
	const projectIdfVersion = readProjectIdfVersion(_workspaceRoots)

	// An open ESP-IDF project triggers the strip even with no toolchain installed
	// (mirrors the always-visible nRF strip — honest "not detected" beats showing nothing).
	const projectDetected = classifyWorkspace(_workspaceRoots).apps.some((a) => a.platform === "esp")

	const espDevices = await probeEspDevices().catch(() => [])
	// Resolve the exact chip (S3/C6/…) via esptool — resets the board, cached per serial.
	await resolveEspChips(espDevices).catch(() => {})

	_cache = {
		status: "ready",
		extensionPresent: _extensionInfo.present,
		extensionVersion: _extensionInfo.version,
		idfPresent,
		idfPath: idfPath ?? undefined,
		idfVersion,
		projectIdfVersion,
		projectDetected,
		espDevices,
		lastDetectedAt: Date.now(),
	}

	return _cache
}
