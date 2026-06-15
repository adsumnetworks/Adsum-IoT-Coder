/**
 * ESP-IDF terminal execution — the ESP analogue of executeNordicCommand.
 *
 * It gives TriggerEspActionHandler a terminal in which `idf.py` / `esptool.py`
 * (and the IDF python venv + toolchain) work, AND that VS Code can actually read.
 *
 * Why we run in OUR OWN terminal, not the Espressif extension's:
 *   The Espressif "ESP-IDF" extension creates its terminal in a way that never
 *   gets VS Code *shell integration*. Without shell integration the command
 *   pipeline can't capture output and falls back to grabbing the whole terminal
 *   buffer after a fixed delay — so the agent ends up "screenshotting" the
 *   terminal and mis-reading build/flash results. A terminal we create with
 *   `createTerminal` runs the user's normal shell (zsh/bash/pwsh/fish), which
 *   VS Code *does* integrate — so command output is captured cleanly.
 *
 * So: we create our own named terminal and make every command self-sourcing
 * (`. "$IDF_PATH/export.sh" && …`) via idfEnvResolver, resolving IDF_PATH from
 * the extension's `idf.espIdfPath` setting → `IDF_PATH` env → well-known dirs.
 * We still *read* the extension's setting; we just never run in its terminal.
 * If IDF_PATH can't be resolved we return an actionable error rather than launch
 * a broken terminal (the nRF lesson).
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"
import { getCachedEspEnvironment } from "@/services/esp/EspEnvironmentDetector"
import {
	buildEspShellCommand,
	detectShell,
	enumerateIdfInstalls,
	idfAmbiguousMessage,
	idfNotFoundMessage,
	parseIdfVersionTxt,
	resolveIdfPath,
	type SupportedPlatform,
	selectIdfInstall,
} from "./idfEnvResolver"

/** Distinct name so we only ever reuse OUR terminal, never the extension's. */
const ESP_TERMINAL_NAME = "Adsum ESP-IDF"

/**
 * Terminals we've already sourced the IDF env in. The env persists across
 * commands in the same integrated shell, so after the first `. export.sh && …`
 * we run subsequent commands bare (no re-sourcing — faster and cleaner). Keyed
 * by terminal reference and evicted on close, so a reopened terminal re-sources.
 */
const sourcedTerminals = new Set<vscode.Terminal>()
let closeListenerRegistered = false
function ensureCloseListener(): void {
	if (closeListenerRegistered) {
		return
	}
	closeListenerRegistered = true
	vscode.window.onDidCloseTerminal((t) => sourcedTerminals.delete(t))
}

/** Narrow the host's `process.platform` to the resolver's supported set. */
export function hostPlatform(): SupportedPlatform {
	if (process.platform === "win32") return "win32"
	if (process.platform === "darwin") return "darwin"
	return "linux"
}

/** Our own ESP-IDF terminal, matched by exact name (not the extension's). */
export function findOurEspTerminal(): vscode.Terminal | undefined {
	for (const t of vscode.window.terminals) {
		if (t.name === ESP_TERMINAL_NAME) {
			return t
		}
	}
	return undefined
}

/** The Espressif extension's configured IDF path setting (Tier 1 hint), platform-aware. */
function explicitIdfSetting(platform: SupportedPlatform): string | undefined {
	const cfg = vscode.workspace.getConfiguration("idf")
	return (platform === "win32" ? cfg.get<string>("espIdfPathWin") : undefined) || cfg.get<string>("espIdfPath") || undefined
}

/**
 * Pin-aware IDF selection on the host. Enumerates every install (extension setting, `IDF_PATH`,
 * `~/esp/* /esp-idf`, well-known dirs), then picks the one matching the project's pinned version
 * (from dependencies.lock, via the detector cache). Auto-resolves on a pin match or a sole install;
 * returns `ambiguous` when several installs exist and the project doesn't pin one.
 */
export function selectHostIdf() {
	const platform = hostPlatform()
	const explicit = explicitIdfSetting(platform)
	const listDir = (p: string): string[] => {
		try {
			return fs.readdirSync(p)
		} catch {
			return []
		}
	}
	const readVersion = (idfDir: string): string | undefined => {
		try {
			return parseIdfVersionTxt(fs.readFileSync(path.join(idfDir, "version.txt"), "utf8"))
		} catch {
			return undefined
		}
	}
	const installs = enumerateIdfInstalls(platform, process.env, fs.existsSync, listDir, readVersion, explicit)
	const pin = getCachedEspEnvironment().projectIdfVersion
	return selectIdfInstall(installs, pin, explicit)
}

/**
 * Resolve IDF_PATH on the host (single path, back-compat). Pin-aware via {@link selectHostIdf};
 * returns undefined when nothing is installed OR the choice is ambiguous (callers that need to tell
 * those apart should use {@link selectHostIdf} directly).
 */
export function resolveHostIdfPath(): string | undefined {
	const sel = selectHostIdf()
	if (sel.kind === "resolved") {
		return sel.path
	}
	// Fall back to the legacy first-match resolver only when enumeration found nothing usable
	// (keeps behavior for odd layouts the globber misses).
	if (sel.kind === "none") {
		const platform = hostPlatform()
		return resolveIdfPath(platform, process.env, fs.existsSync, explicitIdfSetting(platform))
	}
	return undefined
}

export interface PreparedEspTerminal {
	terminal: vscode.Terminal
	terminalName: string
	/** True only until the IDF env has been sourced in this terminal once. */
	needsSourcing: boolean
}

/**
 * Get our own ESP-IDF terminal (reuse if present, else create). `needsSourcing`
 * is true only for a terminal we haven't sourced yet; after the first sourced
 * command the caller marks it via {@link markEspTerminalSourced} and subsequent
 * commands run bare (the env persists in the shell session).
 */
export async function prepareEspTerminal(): Promise<PreparedEspTerminal> {
	ensureCloseListener()
	let terminal = findOurEspTerminal()
	if (!terminal) {
		terminal = vscode.window.createTerminal({ name: ESP_TERMINAL_NAME })
	}
	terminal.show()
	return { terminal, terminalName: terminal.name, needsSourcing: !sourcedTerminals.has(terminal) }
}

/**
 * Record that the IDF env has been sourced in this terminal. Call ONLY after a
 * sourced command actually ran (IDF_PATH resolved), so a failed first command
 * re-sources next time rather than running bare in an unsourced shell.
 */
export function markEspTerminalSourced(terminal: vscode.Terminal): void {
	sourcedTerminals.add(terminal)
}

export interface BuiltEspCommand {
	command?: string
	error?: string
}

/**
 * Shape a raw command `body` (e.g. `idf.py -C "<proj>" build`, `esptool.py
 * flash_id`, a capture-script invocation) for the prepared terminal. When the
 * terminal isn't pre-sourced (always, for our terminal), resolve IDF_PATH and
 * prepend the export script; on resolution failure return an actionable error
 * instead of a broken command.
 */
export function wrapEspCommand(body: string, needsSourcing: boolean): BuiltEspCommand {
	const platform = hostPlatform()
	if (!needsSourcing) {
		return { command: body }
	}
	const selection = selectHostIdf()
	if (selection.kind === "ambiguous") {
		// Several IDF versions installed and the project pins none — ask the user instead of
		// silently sourcing one (the v5.5.2-vs-v6.0 bug).
		return { error: idfAmbiguousMessage(selection.installs) }
	}
	const idfPath = selection.kind === "resolved" ? selection.path : resolveHostIdfPath()
	if (!idfPath) {
		return { error: idfNotFoundMessage(platform) }
	}
	const shell = detectShell(vscode.env.shell || "", platform)
	return { command: buildEspShellCommand({ platform, shell, needsSourcing: true, body, idfPath }) }
}
