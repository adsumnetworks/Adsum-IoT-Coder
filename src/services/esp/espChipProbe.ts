/**
 * Resolve the exact ESP chip (ESP32-S3 / C6 / …) behind a serial port.
 *
 * Passive USB VID/PID detection can only say "ESP32-family". The exact chip
 * needs esptool to connect, which resets the board (esptool docs: `flash_id`
 * uses the default DTR/RTS reset before talking to the ROM). We accept that
 * reset (Omar, 2026-06-12) but cache the result per board serial so we don't
 * reset a board we already identified — only a manual refresh re-probes.
 *
 * Grounded in the official esptool sources (Espressif Docs MCP, 2026-06-12):
 *   - `esptool --port <PORT> flash_id` prints "Chip is <NAME> (revision <REV>)".
 *   - esptool + pyserial live in the IDF python env, the reliable cross-OS
 *     interpreter to run them: <IDF_TOOLS_PATH>/python_env/<env>/bin/python
 *     (POSIX) or …/Scripts/python.exe (Windows). IDF_TOOLS_PATH defaults to
 *     ~/.espressif (%USERPROFILE%\.espressif on Windows).
 *
 * All filesystem/exec effects are injected so the resolver + parser are unit-tested.
 */

import { exec } from "child_process"
import { existsSync, readdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { promisify } from "util"

const execAsync = promisify(exec)

export type EspPlatform = "win32" | "darwin" | "linux"

export interface ChipResult {
	chip?: string
	chipRevision?: string
	/** Chip base MAC (6 octets, e.g. "ac:eb:e6:0c:f8:c0"), parsed from esptool's connect banner when present. */
	mac?: string
}

// ---------------------------------------------------------------------------
// Pure: parse esptool flash_id / chip_id output
// ---------------------------------------------------------------------------

/**
 * Extract the 6-octet BASE MAC from esptool output. esptool prints both a "BASE MAC:" (6 octets) and, on chips
 * with an EUI-64, a longer "MAC:" (8 octets) — we want the 6-octet base, which matches what a native-USB port
 * reports as its USB serial number. The `(?!:)` guard stops us grabbing the first 6 octets of an 8-octet line.
 * Pure; exported for tests.
 */
export function parseEsptoolMac(stdout: string): string | undefined {
	const base = stdout.match(/BASE MAC:\s*([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})/)
	if (base) {
		return base[1].toLowerCase()
	}
	const m = stdout.match(/\bMAC:\s*([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})(?!:)/)
	return m ? m[1].toLowerCase() : undefined
}

/**
 * Parse the chip identity out of esptool stdout. Pure; exported for tests.
 * Handles both "Chip is ESP32-S3 (revision v0.2)" and the older
 * "Detecting chip type... ESP32-S3" line, returning the most specific match.
 * Also surfaces the base MAC (when present) so callers can fold a board's two USB interfaces into one.
 */
export function parseEsptoolChip(stdout: string): ChipResult {
	const mac = parseEsptoolMac(stdout)
	// Preferred: "Chip is ESP32-S3 (revision v0.2)"
	const chipIs = stdout.match(/Chip is ([A-Za-z0-9-]+)(?:\s*\(revision\s*([^)]+)\))?/)
	if (chipIs) {
		return { chip: chipIs[1].trim(), chipRevision: chipIs[2]?.trim(), mac }
	}
	// Fallback: "Detecting chip type... ESP32-S3"
	const detecting = stdout.match(/Detecting chip type\.\.\.\s*([A-Za-z0-9-]+)/)
	if (detecting) {
		return { chip: detecting[1].trim(), mac }
	}
	return { mac }
}

// ---------------------------------------------------------------------------
// Resolve the IDF python interpreter (cross-OS)
// ---------------------------------------------------------------------------

export interface IdfPythonDeps {
	platform: EspPlatform
	env: NodeJS.ProcessEnv
	home: string
	exists: (p: string) => boolean
	listDir: (p: string) => string[]
	/** Explicit IDF tools path from the Espressif extension's `idf.toolsPath` setting (Tier 1 hint). */
	toolsPathHint?: string
}

/**
 * IDF tools path priority: the Espressif extension's `idf.toolsPath` setting → `$IDF_TOOLS_PATH` →
 * ~/.espressif (%USERPROFILE%\.espressif on Windows). The extension setting matters because users who
 * install ESP-IDF to a non-default location have their python_env there, not under ~/.espressif —
 * without it the chip probe finds no python and the board shows as the generic "ESP32-family".
 */
export function idfToolsPath(deps: Pick<IdfPythonDeps, "platform" | "env" | "home" | "toolsPathHint">): string {
	if (deps.toolsPathHint) {
		return deps.toolsPathHint
	}
	if (deps.env.IDF_TOOLS_PATH) {
		return deps.env.IDF_TOOLS_PATH
	}
	const base = deps.platform === "win32" ? deps.env.USERPROFILE || deps.home : deps.home
	return join(base, ".espressif")
}

/**
 * Resolve the IDF python executable, or undefined if not found. Looks under
 * <IDF_TOOLS_PATH>/python_env/<env>/{bin/python | Scripts/python.exe}, picking
 * the last (usually newest) matching env. Pure under injected deps.
 *
 * On Windows we build a layered search list so every common install layout is
 * covered without requiring the user to configure anything:
 *   1. toolsPathHint — the Espressif extension's idf.toolsPathWin (e.g. C:\Espressif
 *      or %USERPROFILE%\.espressif depending on extension version / install method)
 *   2. IDF_TOOLS_PATH env — set by the IDF installer or the user
 *   3. %USERPROFILE%\.espressif — the classic/manual install default
 *   4. C:\Espressif — the standalone IDF Tools GUI installer default
 * De-duplication avoids checking the same directory twice when two sources agree.
 */
export function resolveIdfPython(deps: IdfPythonDeps): string | undefined {
	const seen = new Set<string>()
	const bases: string[] = []
	const add = (p: string | undefined) => {
		if (p && !seen.has(p)) {
			seen.add(p)
			bases.push(p)
		}
	}
	// Tier 1: extension hint (idf.toolsPathWin / idf.toolsPath)
	if (deps.toolsPathHint) add(deps.toolsPathHint)
	// Tier 2: IDF_TOOLS_PATH env var
	if (deps.env.IDF_TOOLS_PATH) add(deps.env.IDF_TOOLS_PATH)
	// Tier 3 (Windows): the two default install roots — always probe both so that
	// the user never has to configure anything regardless of how IDF was installed.
	if (deps.platform === "win32") {
		const userProfile = deps.env.USERPROFILE || deps.home
		add(join(userProfile, ".espressif")) // classic manual / extension default
		add(join("C:\\", "Espressif")) // standalone IDF Tools GUI installer
	} else {
		add(join(deps.home, ".espressif")) // macOS / Linux manual install
	}
	const rel = deps.platform === "win32" ? join("Scripts", "python.exe") : join("bin", "python")

	// Search by SHAPE, not by a list of known layouts.
	//
	// Espressif keeps moving the python env, and chasing each move with another hardcoded branch has
	// already failed twice. Observed in the wild, all with the same IDF version:
	//   A  <base>/python_env/<env>/                     classic install.sh
	//   B  <base>/tools/python/<ver>/venv/              the eim this function was last patched for
	//   C  <base>/tools/python_env/<env>/               eim 0.18 per Espressif's own config docs
	//   D  <base>/<idf-ver>/python_env/<env>/           eim variant
	//   E  <base>/<idf-ver>/tools/python_env/<env>/     eim 0.1.x (seen on the Adsum bench)
	// Only A and B resolved; C, D and E all degraded the board to "model unknown" with no way for the
	// user to tell why. So: expand each base one directory level (that covers the <idf-ver> nesting in
	// D and E), then look for either python-env shape under it. Two shapes × two levels beats five
	// literal paths, and it survives the next reshuffle.
	const roots: string[] = []
	const addRoot = (p: string) => {
		if (!roots.includes(p)) {
			roots.push(p)
		}
	}
	for (const base of bases) {
		addRoot(base)
		addRoot(join(base, "tools"))
		// One level of version nesting: <base>/<idf-ver>[/tools]. Descending order so a newer IDF wins.
		let children: string[] = []
		try {
			children = deps.listDir(base).sort().reverse()
		} catch {
			children = []
		}
		for (const child of children) {
			addRoot(join(base, child))
			addRoot(join(base, child, "tools"))
		}
	}

	/** `<root>/python_env/<env>/…` — the classic and current-eim shape. */
	const fromPythonEnv = (root: string): string | undefined => {
		const dir = join(root, "python_env")
		if (!deps.exists(dir)) {
			return undefined
		}
		for (const env of deps.listDir(dir).sort().reverse()) {
			const candidate = join(dir, env, rel)
			if (deps.exists(candidate)) {
				return candidate
			}
		}
		return undefined
	}

	/** `<root>/python/<ver>/venv/…` — the eim shape this function was previously patched for. */
	const fromToolsPython = (root: string): string | undefined => {
		const dir = join(root, "python")
		if (!deps.exists(dir)) {
			return undefined
		}
		for (const ver of deps.listDir(dir).sort().reverse()) {
			const candidate = join(dir, ver, "venv", rel)
			if (deps.exists(candidate)) {
				return candidate
			}
		}
		return undefined
	}

	for (const root of roots) {
		const hit = fromPythonEnv(root) ?? fromToolsPython(root)
		if (hit) {
			return hit
		}
	}
	return undefined
}

/** Injected from extension.ts: the Espressif extension's `idf.toolsPath` setting (per-OS). */
let _idfToolsPathHint: string | undefined
export function setIdfToolsPathHint(p: string | undefined): void {
	_idfToolsPathHint = p
}

function realDeps(): IdfPythonDeps {
	const platform: EspPlatform = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux"
	return {
		platform,
		env: process.env,
		home: homedir(),
		exists: existsSync,
		listDir: (p) => {
			try {
				return readdirSync(p)
			} catch {
				return []
			}
		},
		toolsPathHint: _idfToolsPathHint,
	}
}

// ---------------------------------------------------------------------------
// Probe a single port (resets the board)
// ---------------------------------------------------------------------------

/**
 * Run `esptool flash_id` against one port and return the chip identity.
 * Resets the board. Returns {} on any failure (no IDF python, timeout, not an
 * ESP after all) — callers fall back to the passive "ESP32-family" label.
 */
export async function probeChip(idfPython: string, port: string, timeoutMs = 12000): Promise<ChipResult> {
	try {
		const { stdout } = await execAsync(`"${idfPython}" -m esptool --port "${port}" flash_id`, { timeout: timeoutMs })
		return parseEsptoolChip(stdout)
	} catch (err) {
		// esptool prints the chip line to stdout even on later failures; salvage it if present.
		const out = (err as { stdout?: string })?.stdout
		if (typeof out === "string") {
			const salvaged = parseEsptoolChip(out)
			if (salvaged.chip) {
				return salvaged
			}
		}
		return {}
	}
}

/** Resolve the IDF python once (real filesystem). Undefined when IDF isn't installed. */
export function getIdfPython(): string | undefined {
	return resolveIdfPython(realDeps())
}
