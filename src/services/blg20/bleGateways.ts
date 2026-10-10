import { execFile } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Logger } from "@services/logging/Logger"
import type { Blg20BleRow } from "@shared/blg20"
import { HostProvider } from "@/hosts/host-provider"
import { resolveToolAsync } from "@/services/tools/ToolResolver"

/**
 * Gateways seen over Bluetooth: the LBG20x's only service port (its USB-C carries power, not data), and the BLG20x's
 * second one from firmware 0.3.6.
 *
 * The scan is the service tool's own `list --ble --json` (a few seconds of listening), run on the Python the extension
 * carries for it, so it needs nothing installed. It runs only when someone asks for the desk to be read, the Hardware
 * page's refresh, or at start-up on a computer that has seen a gateway over Bluetooth before: a first scan makes
 * macOS ask whether the editor may use Bluetooth, and that question must follow from something the developer did.
 *
 * A unit advertises only inside its commissioning window. One seen earlier in this session and gone now is kept,
 * marked with its window closed, so the page can say "hold its button 3 s" instead of forgetting it.
 */

const TOOL_ID = "adsum/nrf/tools/blg20-service"
const SCAN_S = 4

const seen = new Map<string, Blg20BleRow>()
let lastError: string | undefined
let lastScanAt = 0
let running: Promise<Blg20BleRow[]> | null = null

/** The units from the last scan, plus the ones seen earlier in this session whose window has closed since. */
export function getCachedBleRows(): Blg20BleRow[] {
	return [...seen.values()]
}

/** Why the last scan found nothing, in words ("Bluetooth is off", the tool's own error), or undefined. */
export function lastBleScanError(): string | undefined {
	return lastError
}

export function lastBleScanTime(): number {
	return lastScanAt
}

function seenMarker(): string | undefined {
	try {
		const dir = HostProvider.get().globalStorageFsPath
		return dir ? path.join(dir, "ble-gateways-seen.json") : undefined
	} catch {
		return undefined
	}
}

/** True once a gateway has been seen over Bluetooth on this computer: start-up may scan from then on. */
export function bleGatewaySeenBefore(): boolean {
	const f = seenMarker()
	return !!f && existsSync(f)
}

function markSeen(n: number): void {
	const f = seenMarker()
	if (!f || n === 0) return
	try {
		mkdirSync(path.dirname(f), { recursive: true })
		writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), units: n }))
	} catch {
		// a marker is a convenience; never a reason to fail a scan
	}
}

/** Pure: fold one scan's answer into what is known. Exported for the tests. */
export function foldScan(known: Map<string, Blg20BleRow>, answer: unknown): { rows: Blg20BleRow[]; error?: string } {
	const a = answer as { ok?: boolean; units?: Blg20BleRow[]; error?: string } | null
	if (!a || a.ok !== true || !Array.isArray(a.units)) {
		return { rows: [...known.values()], error: a?.error ?? "the scan gave no answer" }
	}
	const now = new Set<string>()
	for (const u of a.units) {
		const key = (u.id ?? u.name ?? u.address).toUpperCase()
		now.add(key)
		known.set(key, { ...u, window: true })
	}
	for (const [key, u] of known) {
		if (!now.has(key)) known.set(key, { ...u, window: false, rssi: null })
	}
	return { rows: [...known.values()] }
}

/** Run one scan (a second caller shares the running one). Never throws: a failed scan keeps what was known. */
export function scanBleGateways(reason: "refresh" | "startup"): Promise<Blg20BleRow[]> {
	if (running) {
		return running
	}
	running = (async () => {
		try {
			const r = await resolveToolAsync(TOOL_ID)
			if (!("tool" in r) || !r.tool.argv?.length || r.tool.unavailable) {
				lastError = "unavailable" in r ? `the service tool is not available (${r.unavailable})` : r.tool?.unavailable
				return getCachedBleRows()
			}
			const argv = [...r.tool.argv, "list", "--ble", "--json", "--timeout", String(SCAN_S)]
			const out = await new Promise<string>((resolve) => {
				execFile(
					argv[0],
					argv.slice(1),
					{ timeout: (SCAN_S + 25) * 1000, maxBuffer: 1 << 20, windowsHide: true },
					(_err, stdout) => resolve(String(stdout ?? "")),
				)
			})
			let answer: unknown = null
			try {
				answer = JSON.parse(out.trim().split(/\r?\n/).pop() ?? "")
			} catch {
				answer = null
			}
			const { rows, error } = foldScan(seen, answer)
			lastError = error
			lastScanAt = Date.now()
			markSeen(rows.filter((u) => u.window).length)
			Logger.info(
				`bleGateways: ${reason} scan: ${rows.filter((u) => u.window).length} in range${error ? ` (${error})` : ""}`,
			)
			return rows
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e)
			Logger.warn(`bleGateways: ${reason} scan failed: ${lastError}`)
			return getCachedBleRows()
		} finally {
			running = null
		}
	})()
	return running
}
