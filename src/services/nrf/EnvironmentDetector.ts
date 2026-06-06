import type { NrfBoard, NrfEnvironment } from "@shared/nrf"
import { exec } from "child_process"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { promisify } from "util"
import { telemetryService } from "@/services/telemetry"

export type { NrfBoard, NrfEnvironment }

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

export async function detectNrfEnvironment(): Promise<NrfEnvironment> {
	_cache = { ...getCachedNrfEnvironment(), status: "detecting" }

	const boardsResult = await probeBoards().catch(() => ({ nrfutilPresent: false, boards: [] as NrfBoard[] }))

	_cache = {
		status: "ready",
		extensionPresent: _extensionInfo.present,
		extensionVersion: _extensionInfo.version,
		nrfutilPresent: boardsResult.nrfutilPresent,
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
