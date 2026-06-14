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
import * as vscode from "vscode"
import { buildEspShellCommand, detectShell, idfNotFoundMessage, resolveIdfPath, type SupportedPlatform } from "./idfEnvResolver"

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

/**
 * Resolve IDF_PATH on the host: the Espressif extension's `idf.espIdfPath`
 * setting (Tier 1 hint) → `IDF_PATH` env → well-known install dirs. We read the
 * extension's setting but never invoke its commands or use its terminal.
 */
export function resolveHostIdfPath(): string | undefined {
	const platform = hostPlatform()
	const cfg = vscode.workspace.getConfiguration("idf")
	const explicit =
		(platform === "win32" ? cfg.get<string>("espIdfPathWin") : undefined) || cfg.get<string>("espIdfPath") || undefined
	return resolveIdfPath(platform, process.env, fs.existsSync, explicit)
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
	const idfPath = resolveHostIdfPath()
	if (!idfPath) {
		return { error: idfNotFoundMessage(platform) }
	}
	const shell = detectShell(vscode.env.shell || "", platform)
	return { command: buildEspShellCommand({ platform, shell, needsSourcing: true, body, idfPath }) }
}
