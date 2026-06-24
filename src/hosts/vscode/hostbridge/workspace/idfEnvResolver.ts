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

// ── Multi-install enumeration + pin-aware selection ─────────────────────────────
//
// `resolveIdfPath` above returns the FIRST valid path and stops — it cannot see that the user has
// several IDF versions installed (e.g. ~/esp/v5.5.2 and ~/esp/v6.0) or that the project pins one of
// them. These helpers enumerate ALL installs and pick the one that matches the project's pinned
// version (from dependencies.lock), asking only when genuinely ambiguous.

export interface IdfInstall {
	/** Absolute path of the IDF checkout (the dir containing export.sh). */
	path: string
	/** Normalized version (no leading 'v'), e.g. "5.5.2"; undefined if version.txt is missing/unreadable. */
	version?: string
}

export type IdfSelection =
	| { kind: "resolved"; path: string; version?: string }
	| { kind: "ambiguous"; installs: IdfInstall[] }
	| { kind: "none" }

/** Normalize a version for comparison: strip a leading 'v', keep the digit/dot core. "v5.5.2" → "5.5.2". */
export function normalizeIdfVersion(v: string | undefined): string | undefined {
	if (!v) return undefined
	const m = v.trim().match(/v?(\d+(?:\.\d+)*)/)
	return m ? m[1] : undefined
}

/** Parse a version.txt body to a normalized version. Pure; exported for tests. */
export function parseIdfVersionTxt(content: string): string | undefined {
	return normalizeIdfVersion(content)
}

/**
 * Parse an ESP-IDF version from `tools/cmake/version.cmake`. This file exists in EVERY IDF checkout
 * (release tarball, git clone, AND the VS Code extension's managed installs) — unlike `version.txt`,
 * which only ships in release tarballs and is ABSENT from extension/git installs (the real-world cause
 * of "version undefined → can't match the project pin → ambiguous forever"). The file sets:
 *   set(IDF_VERSION_MAJOR 6)
 *   set(IDF_VERSION_MINOR 0)
 *   set(IDF_VERSION_PATCH 0)
 * Returns the normalized "MAJOR.MINOR.PATCH" (e.g. "6.0.0", matching dependencies.lock's `idf:` version),
 * or undefined if any component is missing. Pure; exported for tests.
 */
export function parseIdfVersionCmake(content: string): string | undefined {
	const grab = (key: string): string | undefined => content.match(new RegExp(`set\\(\\s*${key}\\s+(\\d+)`, "i"))?.[1]
	const major = grab("IDF_VERSION_MAJOR")
	const minor = grab("IDF_VERSION_MINOR")
	const patch = grab("IDF_VERSION_PATCH")
	if (major === undefined || minor === undefined || patch === undefined) {
		return undefined
	}
	return `${major}.${minor}.${patch}`
}

/**
 * Container directories whose children are scanned for IDF installs. The IDF
 * root can sit in two shapes under a container, and we don't assume which:
 *   - `<container>/<ver>/esp-idf`  — the Espressif VS Code extension's Express
 *     layout (e.g. `C:\esp\v5.5.4\esp-idf`, `~/esp/v5.5.2/esp-idf`).
 *   - `<container>/esp-idf-v5.x.x` — the standalone IDF Tools installer, which
 *     drops the checkout directly under `C:\Espressif\frameworks\`.
 * `enumerateIdfInstalls` probes both the entry itself and `<entry>/esp-idf` for
 * every container, so a new container only needs listing here once.
 */
function idfContainerDirs(platform: SupportedPlatform, env: NodeJS.ProcessEnv): string[] {
	const home = os.homedir()
	if (platform === "win32") {
		const userProfile = env["USERPROFILE"] || home
		return [
			joinFor("win32", userProfile, "esp"), // extension Express default: %USERPROFILE%\esp\<ver>\esp-idf
			joinFor("win32", "C:\\", "esp"), // extension with container on C:\ : C:\esp\<ver>\esp-idf
			joinFor("win32", "C:\\", "Espressif", "frameworks"), // IDF Tools installer: C:\Espressif\frameworks\esp-idf-v5.x
		]
	}
	return [
		joinFor(platform, home, "esp"), // ~/esp/<ver>/esp-idf
		joinFor(platform, "/opt", "esp"), // /opt/esp/<ver>/esp-idf (shared/system installs)
	]
}

/**
 * Enumerate EVERY valid ESP-IDF install on the machine (de-duped by path): the explicit extension
 * setting, `IDF_PATH`, the well-known fixed dirs, AND a glob of `~/esp/* /esp-idf` (this is what finds
 * versioned installs like `v5.5.2` / `v6.0` that the fixed list misses). `version` is read per install
 * from `{path}/version.txt`. Filesystem effects are injected so this is pure under test.
 */
export function enumerateIdfInstalls(
	platform: SupportedPlatform,
	env: NodeJS.ProcessEnv,
	exists: (p: string) => boolean,
	listDir: (p: string) => string[],
	readVersion: (idfDir: string) => string | undefined,
	explicitPath?: string,
): IdfInstall[] {
	const found = new Map<string, IdfInstall>()
	const add = (dir?: string) => {
		if (dir && !found.has(dir) && isIdfDir(platform, dir, exists)) {
			found.set(dir, { path: dir, version: normalizeIdfVersion(readVersion(dir)) })
		}
	}
	add(explicitPath)
	add(env["IDF_PATH"])
	// Scan each container's children for versioned installs, probing BOTH shapes:
	//   <container>/<entry>            — IDF Tools installer (entry IS the root, e.g. esp-idf-v5.x)
	//   <container>/<entry>/esp-idf    — extension Express layout (e.g. v5.5.4/esp-idf)
	// `add` validates with export.sh, so the wrong shape is simply ignored.
	for (const dir of idfContainerDirs(platform, env)) {
		for (const entry of listDir(dir)) {
			add(joinFor(platform, dir, entry))
			add(joinFor(platform, dir, entry, "esp-idf"))
		}
	}
	for (const candidate of getIdfPathCandidates(platform, env)) {
		add(candidate)
	}
	return Array.from(found.values())
}

/**
 * Pick which install to use. Priority:
 *   1. the project's pinned version (dependencies.lock) — when installed. This is the GROUND TRUTH for
 *      a pinned project and MUST win over a remembered/override choice: a v6.0 remembered from testing
 *      another project must never hijack a project whose lock pins v5.5.2.
 *   2. the explicit `idf_version` the agent passed this call — only when there's no usable pin (the
 *      ambiguous, no-pin case the param exists for).
 *   3. the per-project choice remembered earlier (workspaceState) — likewise only when there's no pin.
 *   4. a pin that is set but NOT installed → can't honor: sole install uses it, else ask.
 *   5. the explicit extension-setting path.
 *   6. the sole install (no real choice to make).
 *   7. several installed and nothing decided → **ambiguous**; nothing installed → **none**.
 *
 * Explicit/persisted/pin only resolve when that version is actually installed. `opts.explicit` /
 * `opts.persisted` are version strings (any `v`-prefix tolerated). Back-compat: the positional
 * `pinnedVersion` / `explicitPath` params are unchanged.
 */
export function selectIdfInstall(
	installs: IdfInstall[],
	pinnedVersion?: string,
	explicitPath?: string,
	opts: { explicit?: string; persisted?: string } = {},
): IdfSelection {
	if (installs.length === 0) {
		return { kind: "none" }
	}
	const resolved = (i: IdfInstall): IdfSelection => ({ kind: "resolved", path: i.path, version: i.version })
	const byVersion = (v?: string): IdfInstall | undefined => {
		const n = normalizeIdfVersion(v)
		return n ? installs.find((i) => i.version === n) : undefined
	}

	// 1. Project pin first — honor what the project's own lock declares. A pinned, installed version is
	//    authoritative; nothing remembered or passed may override it.
	const pin = normalizeIdfVersion(pinnedVersion)
	const pinMatch = pin ? installs.find((i) => i.version === pin) : undefined
	if (pinMatch) {
		return resolved(pinMatch)
	}

	// 2/3. No usable pin → the explicit override (this call), then the remembered per-project choice.
	const explicitMatch = byVersion(opts.explicit)
	if (explicitMatch) {
		return resolved(explicitMatch)
	}
	const persistedMatch = byVersion(opts.persisted)
	if (persistedMatch) {
		return resolved(persistedMatch)
	}

	// 4. A pin was declared but that version isn't installed — can't honor it: sole install → use it; several → ask.
	if (pin) {
		return installs.length === 1 ? resolved(installs[0]) : { kind: "ambiguous", installs }
	}

	// 5. Explicit extension-setting path.
	if (explicitPath) {
		const ex = installs.find((i) => i.path === explicitPath)
		if (ex) {
			return resolved(ex)
		}
	}
	// 6/7. Sole install → use it; several with nothing decided → ask.
	if (installs.length === 1) {
		return resolved(installs[0])
	}
	return { kind: "ambiguous", installs }
}

/**
 * Actionable message when several IDF installs exist and the project doesn't pin one. Mirrors nRF's
 * `ncsAmbiguousMessage`: tells the agent to ask the user ONCE and re-run with `idf_version="…"`, which
 * is then remembered per project — NOT to fiddle with the extension's selector or source export.sh by
 * hand (that pushed the agent off our tool into a plain terminal).
 */
export function idfAmbiguousMessage(installs: IdfInstall[]): string {
	const list = installs.map((i) => `  - ${i.path}${i.version ? ` (v${i.version})` : ""}`).join("\n")
	return (
		"Multiple ESP-IDF versions are installed and this project does not pin one " +
		"(no resolved `idf:` version in dependencies.lock):\n" +
		`${list}\n` +
		"Ask the user which ESP-IDF version to use, then re-run this action with " +
		'`idf_version="5.5.2"`. The choice is remembered for this project.'
	)
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
