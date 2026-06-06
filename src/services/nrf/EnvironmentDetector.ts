import type { NrfBoard, NrfEnvironment } from "@shared/nrf"
import { exec } from "child_process"
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

/** Pure parser for `nrfutil device list --json` stdout. Exported for unit tests. */
export function parseDeviceList(stdout: string): string[] {
	try {
		const json = JSON.parse(stdout)
		if (Array.isArray(json?.devices)) {
			return json.devices.map((d: Record<string, unknown>) => d.serialNumber as string).filter(Boolean)
		}
		if (Array.isArray(json)) {
			return json.map((d: Record<string, unknown>) => d.serialNumber as string).filter(Boolean)
		}
	} catch {
		// text fallback: match "serial_number: ABC123" or "Serial Number: ABC123"
		const matches = [...stdout.matchAll(/serial[_\s]?number[:\s]+(\S+)/gi)]
		return matches.map((m) => m[1]).filter(Boolean)
	}
	return []
}

/** Pure parser for `nrfutil device device-info --serial-number <SN> --json` stdout. Exported for unit tests. */
export function parseDeviceInfo(stdout: string): Partial<NrfBoard> {
	try {
		const json = JSON.parse(stdout)
		const dev = json?.device ?? json
		return {
			deviceFamily: (dev?.deviceFamily ?? dev?.device_family) as string | undefined,
			deviceName: (dev?.deviceName ?? dev?.device_name) as string | undefined,
			deviceVersion: (dev?.deviceVersion ?? dev?.device_version) as string | undefined,
		}
	} catch {
		const family = stdout.match(/device[_\s]?family[:\s]+(\S+)/i)?.[1]
		const name = stdout.match(/device[_\s]?name[:\s]+([^\n\r]+)/i)?.[1]?.trim()
		const version = stdout.match(/device[_\s]?version[:\s]+(\S+)/i)?.[1]
		return { deviceFamily: family, deviceName: name, deviceVersion: version }
	}
}

async function probeBoards(): Promise<{ nrfutilPresent: boolean; boards: NrfBoard[] }> {
	try {
		const listResult = await execAsync("nrfutil device list --json", { timeout: 5000 })
		const serials = parseDeviceList(listResult.stdout)

		if (serials.length === 0) {
			return { nrfutilPresent: true, boards: [] }
		}

		const boards = await Promise.all(
			serials.map(async (serialNumber) => {
				try {
					const infoResult = await execAsync(`nrfutil device device-info --serial-number ${serialNumber} --json`, {
						timeout: 5000,
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
