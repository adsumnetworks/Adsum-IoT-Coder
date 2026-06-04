/**
 * Cross-platform resolver for the ESP-IDF build environment.
 *
 * `idf.py` only works once the ESP-IDF environment is active: `IDF_PATH` set,
 * the Xtensa/RISC-V toolchain on `PATH`, and the IDF Python venv selected. A
 * plain terminal has none of it. ESP-IDF ships an "export" script that sets all
 * of this up, one per shell family:
 *   - bash / zsh:   $IDF_PATH/export.sh
 *   - PowerShell:   $IDF_PATH/export.ps1
 *   - cmd.exe:      %IDF_PATH%\export.bat
 *
 * Strategy (two-tier): callers pass an `explicitPath` discovered from the
 * Espressif ESP-IDF VS Code extension's `idf.espIdfPath` setting (Tier 1). If
 * that's absent or invalid we fall back to `IDF_PATH` and a set of well-known
 * install locations (Tier 2). We never call the extension's own commands — that
 * would couple us to its versioned API.
 *
 * The pure helpers here are unit-tested against simulated filesystems / env for
 * all three platforms. Side-effecting callers compose them with `fs.existsSync`.
 */

import * as os from "node:os"
import * as path from "node:path"

export type SupportedPlatform = "win32" | "darwin" | "linux"
export type SupportedShell = "bash" | "zsh" | "powershell" | "cmd"

/**
 * Always use the target platform's separator when building candidate paths,
 * regardless of the host running the code (matters for tests on a Linux runner
 * computing Windows paths). Mirrors jlinkResolver.joinFor.
 */
function joinFor(platform: SupportedPlatform, ...parts: string[]): string {
	return platform === "win32" ? path.win32.join(...parts) : path.posix.join(...parts)
}

/**
 * A directory is treated as a valid IDF checkout iff it contains `export.sh`.
 * That script ships on every platform regardless of which shell you use, so it
 * is a reliable, shell-independent "is this IDF_PATH" probe.
 */
export function isIdfDir(platform: SupportedPlatform, dir: string, exists: (p: string) => boolean): boolean {
	if (!dir) return false
	return exists(joinFor(platform, dir, "export.sh"))
}

/**
 * Well-known IDF_PATH install locations, in priority order, per platform.
 * Covers the Espressif IDF Tools installer default, the VS Code extension's
 * default (~/esp/esp-idf, ~/esp/v5.x/esp-idf), and ~/.espressif checkouts.
 */
export function getIdfPathCandidates(platform: SupportedPlatform, env: NodeJS.ProcessEnv = process.env): string[] {
	const home = os.homedir()
	if (platform === "win32") {
		const userProfile = env["USERPROFILE"] || home
		return [
			joinFor("win32", userProfile, "esp", "esp-idf"),
			joinFor("win32", userProfile, "esp", "v5.5", "esp-idf"),
			joinFor("win32", "C:\\", "esp", "esp-idf"),
			// Espressif IDF Tools installer default
			joinFor("win32", "C:\\", "Espressif", "frameworks", "esp-idf"),
		]
	}
	// macOS + Linux share the ~/esp layout
	return [
		joinFor(platform, home, "esp", "esp-idf"),
		joinFor(platform, home, "esp", "v5.5", "esp-idf"),
		joinFor(platform, home, ".espressif", "esp-idf"),
		"/opt/esp/idf",
	]
}

/** The export-script filename for a given shell family. */
export function getExportScriptName(shell: SupportedShell): string {
	if (shell === "powershell") return "export.ps1"
	if (shell === "cmd") return "export.bat"
	return "export.sh" // bash / zsh
}

/**
 * Best-effort map a shell executable path / name to a supported shell family,
 * falling back to the platform default (PowerShell on Windows, bash elsewhere).
 */
export function detectShell(shellPathOrName: string, platform: SupportedPlatform): SupportedShell {
	const s = (shellPathOrName || "").toLowerCase()
	if (s.includes("powershell") || s.includes("pwsh")) return "powershell"
	if (s.includes("cmd")) return "cmd"
	if (s.includes("zsh")) return "zsh"
	if (s.includes("bash") || s.endsWith("/sh") || s === "sh") return "bash"
	return platform === "win32" ? "powershell" : "bash"
}

/**
 * Full resolution: explicit (ESP-IDF extension setting) → `IDF_PATH` env →
 * well-known install dirs. Returns the first directory that is a valid IDF
 * checkout, or `undefined` if none is found (caller should fail loudly with a
 * fix-it message rather than launch a broken terminal — the nRF lesson).
 *
 * Filesystem effects are injected (`exists`) so this is pure under test.
 */
export function resolveIdfPath(
	platform: SupportedPlatform,
	env: NodeJS.ProcessEnv,
	exists: (p: string) => boolean,
	explicitPath?: string,
): string | undefined {
	if (explicitPath && isIdfDir(platform, explicitPath, exists)) {
		return explicitPath
	}
	const fromEnv = env["IDF_PATH"]
	if (fromEnv && isIdfDir(platform, fromEnv, exists)) {
		return fromEnv
	}
	for (const candidate of getIdfPathCandidates(platform, env)) {
		if (isIdfDir(platform, candidate, exists)) {
			return candidate
		}
	}
	return undefined
}

/**
 * Wrap an arbitrary command `body` so it runs with the ESP-IDF environment
 * available, shaped for the target shell. This is the general primitive behind
 * the device tool: the body can be `idf.py …`, `esptool.py …`, a capture-script
 * invocation, or any other command that needs the IDF toolchain on PATH.
 *
 * Two tiers:
 *   - `needsSourcing: false` (Tier 1) — the terminal is already an ESP-IDF
 *     terminal (the Espressif extension sourced it for us). Run `body` as-is.
 *   - `needsSourcing: true` (Tier 2) — a plain terminal: prepend the matching
 *     export script so the env is live for `body`, in one chained line:
 *       cmd.exe:    "<export.bat>" && <body>
 *       PowerShell: . "<export.ps1>"; <body>
 *       bash / zsh: . "<export.sh>" && <body>
 *
 * Sourcing (`.`) runs in the current shell so the exported env persists for the
 * command. The export script is quoted to tolerate spaces. `idfPath` is required
 * only when `needsSourcing` is true.
 */
export function buildEspShellCommand(opts: {
	platform: SupportedPlatform
	shell: SupportedShell
	needsSourcing: boolean
	body: string
	idfPath?: string
}): string {
	const { platform, shell, needsSourcing, body, idfPath } = opts
	if (!needsSourcing) {
		return body
	}
	const exportScript = joinFor(platform, idfPath ?? "", getExportScriptName(shell))
	if (shell === "cmd") {
		return `"${exportScript}" && ${body}`
	}
	if (shell === "powershell") {
		return `. "${exportScript}"; ${body}`
	}
	// bash / zsh
	return `. "${exportScript}" && ${body}`
}

/**
 * Build the single shell command that sources the IDF environment and then runs
 * `idf.py <args>` against the given project directory (`-C "<proj>"`). Thin
 * convenience over {@link buildEspShellCommand} for the common build/flash case;
 * always sources (Tier 2).
 */
export function buildIdfCommand(opts: {
	platform: SupportedPlatform
	shell: SupportedShell
	idfPath: string
	projectDir: string
	idfArgs: string[]
}): string {
	const { platform, shell, idfPath, projectDir, idfArgs } = opts
	const body = `idf.py -C "${projectDir}" ${idfArgs.join(" ")}`.trim()
	return buildEspShellCommand({ platform, shell, needsSourcing: true, body, idfPath })
}

/** Human-readable, actionable error when IDF_PATH can't be resolved. */
export function idfNotFoundMessage(platform: SupportedPlatform): string {
	const example = platform === "win32" ? "%USERPROFILE%\\esp\\esp-idf" : "~/esp/esp-idf"
	return (
		"ESP-IDF environment not found. Install the official Espressif ESP-IDF VS Code extension " +
		"(it sets `idf.espIdfPath`), or set the IDF_PATH environment variable to your ESP-IDF " +
		`checkout (e.g. ${example}). Looked in the extension setting, IDF_PATH, and the standard install locations.`
	)
}
