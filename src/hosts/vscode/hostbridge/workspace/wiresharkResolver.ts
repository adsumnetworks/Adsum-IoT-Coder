/**
 * Cross-platform resolver for the Wireshark GUI binary — used to hand off a captured
 * `.pcap` (sniffer) or `.btmon` (HCI) file to the expert's own tool. Mirrors
 * `jlinkResolver.ts`: deterministic known-install-paths first, then a PATH walk.
 * All filesystem effects are injected (`exists`) so this stays pure and unit-testable.
 *
 * Windows-first — most users are on Windows, so the Windows search paths are checked
 * first and verified most carefully; macOS/Linux paths cover the dev/test boxes.
 */

import * as path from "node:path"

export type SupportedPlatform = "win32" | "darwin" | "linux"

function joinFor(platform: SupportedPlatform, ...parts: string[]): string {
	return platform === "win32" ? path.win32.join(...parts) : path.posix.join(...parts)
}

/**
 * Deterministic install locations to check, in priority order, per platform.
 * Wireshark doesn't version its install directory (no JLink_V876-style folders), so
 * unlike jlinkResolver there's no separate "expand versioned dirs" step here.
 */
export function getWiresharkSearchPaths(platform: SupportedPlatform, env: NodeJS.ProcessEnv = process.env): string[] {
	if (platform === "win32") {
		const programFiles = env["ProgramFiles"] || "C:\\Program Files"
		const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
		return [
			joinFor("win32", programFiles, "Wireshark", "Wireshark.exe"),
			joinFor("win32", programFilesX86, "Wireshark", "Wireshark.exe"),
		]
	}

	if (platform === "darwin") {
		// Wireshark.app ships its real binary deep inside the bundle, not a top-level launcher.
		return ["/Applications/Wireshark.app/Contents/MacOS/Wireshark"]
	}

	// Linux: standard package-manager landing spots (apt/dnf/pacman all use /usr/bin or /usr/local/bin).
	return ["/usr/bin/wireshark", "/usr/local/bin/wireshark", "/snap/bin/wireshark"]
}

/** The binary name to look for on PATH — differs by platform (case + extension). */
export function getWiresharkBinaryName(platform: NodeJS.Platform): string {
	return platform === "win32" ? "Wireshark.exe" : "wireshark"
}

/**
 * Walks `PATH` looking for `binaryName`. Returns the first absolute hit, or
 * `undefined` if nothing matches. Separator differs by platform (`;` Windows, `:` Unix).
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
 * Full resolution: optional user override (the `adsum-iot-coder.wiresharkPath` setting,
 * read by the caller and passed in here) → deterministic install paths → PATH lookup.
 * Returns the first existing absolute path, or `undefined` if Wireshark isn't found
 * anywhere — callers MUST treat `undefined` as "don't offer Wireshark to the user".
 */
export function resolveWiresharkBinary(
	platform: SupportedPlatform,
	env: NodeJS.ProcessEnv,
	exists: (p: string) => boolean,
	overridePath?: string,
): string | undefined {
	if (overridePath && exists(overridePath)) {
		return overridePath
	}

	for (const candidate of getWiresharkSearchPaths(platform, env)) {
		if (exists(candidate)) return candidate
	}

	return findOnPath(getWiresharkBinaryName(platform), platform, env, exists)
}
