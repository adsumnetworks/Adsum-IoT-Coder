/**
 * Cross-platform resolver for the SEGGER J-Link interactive CLI binary.
 *
 * SEGGER ships the interactive J-Link CLI under different names per OS:
 * - Windows:        JLink.exe
 * - macOS / Linux:  JLinkExe
 *
 * The pure helpers in this file are unit-tested against simulated filesystems
 * and PATH layouts for all three platforms. Side-effecting callers compose
 * them with `fs.existsSync` and `process.env`.
 */

import * as os from "node:os"
import * as path from "node:path"

export type SupportedPlatform = "win32" | "darwin" | "linux"

export interface JLinkArgs {
	deviceName: string
	serialNumber: string
	rttPort: number
}

/**
 * Always use the target platform's separator when building candidate paths,
 * regardless of where the code happens to be running. `path.join` follows the
 * host OS — that gives the wrong answer when, e.g., a Linux CI runner tries
 * to compute Windows search paths for tests.
 */
function joinFor(platform: SupportedPlatform, ...parts: string[]): string {
	return platform === "win32" ? path.win32.join(...parts) : path.posix.join(...parts)
}

/**
 * Returns the platform-specific JLink interactive CLI binary name.
 *
 * SEGGER's Windows packaging drops the trailing `Exe` (JLink.exe), whereas
 * Linux and macOS keep it (JLinkExe). Any "win32"-like value resolves to the
 * Windows name; everything else falls through to the Unix name (covers
 * darwin, linux, and unknown future platforms we'd prefer not to crash on).
 */
export function getJLinkBinaryName(platform: NodeJS.Platform): string {
	return platform === "win32" ? "JLink.exe" : "JLinkExe"
}

/**
 * Deterministic install locations to check, in priority order, per platform.
 *
 * The returned list is the cross-product of:
 *   1. Standalone SEGGER J-Link installs
 *   2. Nordic Semiconductor command-line tools (ship a bundled JLink)
 *   3. nRF Connect SDK toolchain (ships a bundled JLink under ncs/toolchains)
 *
 * We deliberately don't glob versioned directories here (e.g. JLink_V876) —
 * those are handled by the caller via `expandVersionedJLinkDirs`, which needs
 * `readdirSync` and is therefore injected separately for testability.
 */
export function getJLinkSearchPaths(platform: SupportedPlatform, env: NodeJS.ProcessEnv = process.env): string[] {
	if (platform === "win32") {
		const programFiles = env["ProgramFiles"] || "C:\\Program Files"
		const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
		const localAppData = env["LOCALAPPDATA"] || joinFor("win32", os.homedir(), "AppData", "Local")
		return [
			joinFor("win32", programFiles, "SEGGER", "JLink", "JLink.exe"),
			joinFor("win32", programFilesX86, "SEGGER", "JLink", "JLink.exe"),
			joinFor("win32", programFiles, "Nordic Semiconductor", "nrf-command-line-tools", "bin", "JLink.exe"),
			joinFor("win32", programFilesX86, "Nordic Semiconductor", "nrf-command-line-tools", "bin", "JLink.exe"),
			joinFor("win32", localAppData, "Programs", "SEGGER", "JLink", "JLink.exe"),
		]
	}

	if (platform === "darwin") {
		// macOS ships JLink either via the SEGGER .pkg installer (/Applications)
		// or via Homebrew (intel: /usr/local/bin, Apple Silicon: /opt/homebrew/bin).
		return [
			"/Applications/SEGGER/JLink/JLinkExe",
			"/usr/local/bin/JLinkExe",
			"/opt/homebrew/bin/JLinkExe",
			"/opt/SEGGER/JLink/JLinkExe",
		]
	}

	// Linux: standard SEGGER .deb/.rpm landing spots + Nordic command-line tools.
	return [
		"/opt/SEGGER/JLink/JLinkExe",
		"/usr/bin/JLinkExe",
		"/usr/local/bin/JLinkExe",
		joinFor("linux", os.homedir(), ".local", "bin", "JLinkExe"),
		"/opt/nordic/ncs/toolchains/bin/JLinkExe",
	]
}

/**
 * SEGGER's Windows installer sometimes drops the binary under a versioned
 * folder (e.g. C:\Program Files\SEGGER\JLink_V876) rather than the plain
 * `JLink` folder. We discover those by listing the SEGGER parent and picking
 * any child whose name starts with "JLink".
 *
 * Pure-ish: depends on a `readdir` callback so tests can simulate any
 * directory layout. `readdir` should return [] for nonexistent parents.
 */
export function expandVersionedJLinkDirs(
	platform: SupportedPlatform,
	env: NodeJS.ProcessEnv,
	readdir: (dir: string) => string[],
): string[] {
	const candidates: string[] = []
	const binaryName = getJLinkBinaryName(platform)

	const seggerParents = (() => {
		if (platform === "win32") {
			const pf = env["ProgramFiles"] || "C:\\Program Files"
			const pfx86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
			return [joinFor("win32", pf, "SEGGER"), joinFor("win32", pfx86, "SEGGER")]
		}
		if (platform === "darwin") {
			return ["/Applications/SEGGER"]
		}
		return ["/opt/SEGGER"]
	})()

	for (const parent of seggerParents) {
		const entries = safeReaddir(parent, readdir)
		for (const entry of entries) {
			if (entry.startsWith("JLink") && entry !== "JLink") {
				candidates.push(joinFor(platform, parent, entry, binaryName))
			}
		}
	}

	return candidates
}

function safeReaddir(dir: string, readdir: (dir: string) => string[]): string[] {
	try {
		return readdir(dir)
	} catch {
		return []
	}
}

/**
 * Walks `PATH` looking for `binaryName`. Returns the first absolute hit, or
 * `undefined` if nothing matches.
 *
 * Path separator differs by platform: Windows uses `;`, Unix uses `:`. We
 * derive it from the platform argument rather than `path.delimiter` so tests
 * can drive any platform regardless of the host they run on.
 */
export function findOnPath(
	binaryName: string,
	platform: SupportedPlatform,
	env: NodeJS.ProcessEnv,
	exists: (p: string) => boolean,
): string | undefined {
	const rawPath = env["PATH"] || env["Path"] || ""
	if (!rawPath) return undefined

	const separator = platform === "win32" ? ";" : ":"
	for (const dir of rawPath.split(separator)) {
		if (!dir) continue
		const candidate = joinFor(platform, dir, binaryName)
		if (exists(candidate)) return candidate
	}
	return undefined
}

/**
 * Full resolution: deterministic install paths → versioned SEGGER dirs →
 * PATH lookup. Returns the first existing absolute path, or `undefined` if
 * we couldn't find J-Link anywhere.
 *
 * All filesystem effects are injected (`exists`, `readdir`) so this is a
 * pure function under test.
 */
export function resolveJLinkBinary(
	platform: SupportedPlatform,
	env: NodeJS.ProcessEnv,
	exists: (p: string) => boolean,
	readdir: (dir: string) => string[],
): string | undefined {
	for (const candidate of getJLinkSearchPaths(platform, env)) {
		if (exists(candidate)) return candidate
	}

	for (const candidate of expandVersionedJLinkDirs(platform, env, readdir)) {
		if (exists(candidate)) return candidate
	}

	return findOnPath(getJLinkBinaryName(platform), platform, env, exists)
}

/**
 * Build the J-Link CLI argument list for an RTT capture session.
 *
 * Args are passed as an array (no shell), so no quoting or escaping is
 * required — VS Code's `createTerminal({ shellPath, shellArgs })` invokes
 * the binary directly via Node's `spawn`.
 */
export function buildJLinkArgs(opts: JLinkArgs): string[] {
	return [
		"-device",
		opts.deviceName,
		"-SelectEmuBySN",
		opts.serialNumber,
		"-if",
		"swd",
		"-speed",
		"auto",
		"-AutoConnect",
		"1",
		"-RTTTelnetPort",
		String(opts.rttPort),
	]
}
