/**
 * Cross-platform resolver for the nRF Connect SDK (NCS) build environment.
 *
 * `west build` / `west flash` only work once the NCS toolchain environment is
 * active: ZEPHYR_BASE set, the Zephyr SDK + GNU Arm toolchain on PATH, the right
 * Python venv, west itself. A plain terminal has none of it. Unlike ESP (which
 * ships a per-shell `export.sh`), NCS exposes its environment through nrfutil:
 *
 *   - inspect:  nrfutil sdk-manager toolchain env    --ncs-version <ver>
 *   - run one:  nrfutil sdk-manager toolchain launch --ncs-version <ver> -- <cmd>
 *
 * We use the env form host-side to capture the toolchain environment and inject
 * it into our own terminal (Tier 1 — the developer sees a bare `west build`),
 * and fall back to the launch form as a single visible command (Tier 2). Neither
 * uses shell chaining (`&&`), which keeps it robust on Windows PowerShell 5.1.
 *
 * The pure helpers here are unit-tested; the side-effecting callers in
 * executeNordicCommand.ts compose them with child_process / vscode.
 *
 * Zephyr seam: buildToolchainCommand takes a `strategy` so a future generic
 * Zephyr board ("zephyr": `. zephyr-env.sh && …`) plugs in without touching the
 * handler or the terminal logic.
 */

import type { SupportedPlatform, SupportedShell } from "./idfEnvResolver"

export type { SupportedPlatform, SupportedShell }

/** PATH list separator for the target platform (`;` on Windows, `:` elsewhere). */
export function pathListSep(platform: SupportedPlatform): string {
	return platform === "win32" ? ";" : ":"
}

/**
 * Normalize an NCS version string for comparison: strip a leading `v` and any
 * surrounding whitespace. `installedSdkVersions` look like `v3.2.1`; the project
 * pin from a build/manifest looks like `3.2.1` — normalize both before matching.
 * Returns undefined for empty/undefined input.
 */
export function normalizeNcsVersion(v: string | undefined): string | undefined {
	if (!v) return undefined
	const t = v.trim().replace(/^v/i, "")
	return t.length > 0 ? t : undefined
}

/** Re-add the `v` prefix nrfutil's `--ncs-version` flag expects (`3.2.1` → `v3.2.1`). */
export function toNcsVersionFlag(version: string): string {
	const n = normalizeNcsVersion(version)
	return n ? `v${n}` : version
}

export type NcsSelection = { kind: "resolved"; version: string } | { kind: "ambiguous"; versions: string[] } | { kind: "none" }

/**
 * Pick the NCS version to build/flash with, pin-aware. Pure.
 *
 * Priority:
 *   1. explicit — the agent passed `ncs_version` (highest; it's an override).
 *   2. persisted — the per-project choice the user made earlier (workspaceState).
 *   3. pinned — the project's bound version (build artifact / west manifest).
 *   4. single — exactly one NCS is installed, so there's no real choice.
 *   5. ambiguous — several installed and nothing decided it → ask once.
 *   6. none — nothing installed.
 *
 * `installed` are the versions we know are installed (any `v`-prefix tolerated).
 * Explicit always wins, even if not in the enumerated list (the agent may request
 * a version just installed and not yet re-detected — nrfutil validates at launch).
 * Persisted and pin only resolve when actually installed; otherwise we fall
 * through to single / ambiguous / none.
 */
export function selectNcsInstall(
	installed: string[],
	opts: { explicit?: string; persisted?: string; pinned?: string } = {},
): NcsSelection {
	const norm = (v?: string) => normalizeNcsVersion(v)
	const installedNorm = installed.map(norm).filter((v): v is string => !!v)
	const has = (v?: string) => !!v && installedNorm.includes(v as string)

	// 1. Explicit override always wins — even if not in our enumerated list (the
	//    user may have just installed it; nrfutil will validate at launch time).
	const explicit = norm(opts.explicit)
	if (explicit) return { kind: "resolved", version: explicit }

	// 2. Persisted per-project choice, if still installed.
	const persisted = norm(opts.persisted)
	if (has(persisted)) return { kind: "resolved", version: persisted as string }

	// 3. Project pin (build/manifest), if installed.
	const pinned = norm(opts.pinned)
	if (has(pinned)) return { kind: "resolved", version: pinned as string }

	// 4. Exactly one installed → no real choice.
	if (installedNorm.length === 1) return { kind: "resolved", version: installedNorm[0] }

	// 5/6. Several installed and nothing decided → ask; none installed → none.
	if (installedNorm.length === 0) return { kind: "none" }
	return { kind: "ambiguous", versions: installedNorm }
}

/**
 * Parse the env-variable listing from `nrfutil sdk-manager toolchain env
 * --ncs-version <ver>` into a key→value map. The output is `KEY : VALUE` lines
 * (a colon padded with spaces), e.g.:
 *
 *   PATH                     : C:\ncs\toolchains\...\bin;C:\ncs\...
 *   ZEPHYR_SDK_INSTALL_DIR   : C:\ncs\toolchains\...\opt\zephyr-sdk
 *
 * VALUE may itself contain colons (drive letters, PATH separators), so we split
 * on the FIRST ` : ` only. Lines without that separator (banners, progress) are
 * skipped. Pure; exported for tests.
 */
export function parseToolchainEnv(stdout: string): Record<string, string> {
	const env: Record<string, string> = {}
	for (const raw of stdout.split(/\r?\n/)) {
		const line = raw.trimEnd()
		if (!line.trim()) continue
		// Match "KEY : VALUE" — KEY is a leading run of env-name chars, then a
		// space-padded colon, then the rest (kept verbatim, including colons).
		const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+:\s(.*)$/)
		if (!m) continue
		const [, key, value] = m
		env[key] = value
	}
	return env
}

/** Strategy for sourcing a toolchain env. Today only NCS; `zephyr` is the future seam. */
export type ToolchainStrategy = "ncs"

/**
 * Build the single, visible command that runs `body` inside a specific toolchain
 * environment (Tier 2 — the reliable fallback). No shell chaining, so it works
 * the same on cmd / PowerShell / bash / zsh.
 *
 * For `"ncs"`: `<sdkManagerPrefix> toolchain launch --ncs-version v<ver> -- <body>`.
 * `sdkManagerPrefix` comes from resolveNrfutilCommands (already shell-quoted).
 */
export function buildToolchainCommand(
	strategy: ToolchainStrategy,
	opts: { sdkManagerPrefix: string; version: string; body: string },
): string {
	const { sdkManagerPrefix, version, body } = opts
	switch (strategy) {
		case "ncs":
			return `${sdkManagerPrefix} toolchain launch --ncs-version ${toNcsVersionFlag(version)} -- ${body}`
	}
}

/**
 * Shape a logger-wrapper invocation for the target shell. The loggers don't need
 * the SDK toolchain (only python + JLink/pyserial + `nrfutil device`), so they
 * run bare in our terminal — but invoking a QUOTED executable path differs per
 * shell: PowerShell needs the call operator `&`, cmd/bash run the quoted path
 * directly. `wrapperInvocation` is the already-quoted path plus its args
 * (e.g. `"./assets/scripts/rtt-logger" --capture --port ...`). Pure.
 */
export function buildNordicLoggerCommand(opts: {
	platform: SupportedPlatform
	shell: SupportedShell
	wrapperInvocation: string
}): string {
	const { shell, wrapperInvocation } = opts
	// PowerShell will not execute a string that starts with a quote without `&`.
	if (shell === "powershell") return `& ${wrapperInvocation}`
	return wrapperInvocation
}

// ---------------------------------------------------------------------------
// Actionable messages (mirror idfEnvResolver's *Message helpers)
// ---------------------------------------------------------------------------

/** Several NCS installed and the project pins none — ask the user, then pass `ncs_version`. */
export function ncsAmbiguousMessage(versions: string[]): string {
	const list = versions.map((v) => `  - v${normalizeNcsVersion(v)}`).join("\n")
	return (
		"Multiple nRF Connect SDK versions are installed and this project has no build yet " +
		"(no pinned version to disambiguate):\n" +
		`${list}\n` +
		"Ask the user which NCS version to use, then re-run this action with " +
		'`ncs_version="vX.Y.Z"`. The choice is remembered for this project.'
	)
}

/** No NCS toolchain installed at all. */
export function ncsNotInstalledMessage(): string {
	return (
		"No nRF Connect SDK toolchain is installed. Install one via the nRF Connect for VS Code " +
		"extension (Manage SDKs / Manage Toolchains) or `nrfutil sdk-manager install vX.Y.Z`, then retry."
	)
}

/** nrfutil / sdk-manager couldn't be located, so we can't source a toolchain ourselves. */
export function toolchainUnavailableMessage(): string {
	return (
		"Could not locate nrfutil sdk-manager to source the nRF Connect SDK toolchain. " +
		"Ensure the nRF Connect for VS Code extension (or a standalone nrfutil with the sdk-manager " +
		"command) is installed. Falling back to the nRF Connect terminal if one is available."
	)
}
