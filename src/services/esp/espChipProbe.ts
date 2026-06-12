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
}

// ---------------------------------------------------------------------------
// Pure: parse esptool flash_id / chip_id output
// ---------------------------------------------------------------------------

/**
 * Parse the chip identity out of esptool stdout. Pure; exported for tests.
 * Handles both "Chip is ESP32-S3 (revision v0.2)" and the older
 * "Detecting chip type... ESP32-S3" line, returning the most specific match.
 */
export function parseEsptoolChip(stdout: string): ChipResult {
	// Preferred: "Chip is ESP32-S3 (revision v0.2)"
	const chipIs = stdout.match(/Chip is ([A-Za-z0-9-]+)(?:\s*\(revision\s*([^)]+)\))?/)
	if (chipIs) {
		return { chip: chipIs[1].trim(), chipRevision: chipIs[2]?.trim() }
	}
	// Fallback: "Detecting chip type... ESP32-S3"
	const detecting = stdout.match(/Detecting chip type\.\.\.\s*([A-Za-z0-9-]+)/)
	if (detecting) {
		return { chip: detecting[1].trim() }
	}
	return {}
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
}

/** Default IDF tools path: $IDF_TOOLS_PATH, else ~/.espressif (%USERPROFILE%\.espressif on Windows). */
export function idfToolsPath(deps: Pick<IdfPythonDeps, "platform" | "env" | "home">): string {
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
 */
export function resolveIdfPython(deps: IdfPythonDeps): string | undefined {
	const pythonEnvRoot = join(idfToolsPath(deps), "python_env")
	if (!deps.exists(pythonEnvRoot)) {
		return undefined
	}
	const envDirs = deps.listDir(pythonEnvRoot).sort()
	const rel = deps.platform === "win32" ? join("Scripts", "python.exe") : join("bin", "python")
	// Prefer the last (highest version when names sort lexically, e.g. idf5.3_…).
	for (let i = envDirs.length - 1; i >= 0; i--) {
		const candidate = join(pythonEnvRoot, envDirs[i], rel)
		if (deps.exists(candidate)) {
			return candidate
		}
	}
	return undefined
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
