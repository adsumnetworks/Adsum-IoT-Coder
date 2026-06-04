/**
 * ESP-IDF terminal execution — the ESP analogue of executeNordicCommand.
 *
 * It gives TriggerEspActionHandler a terminal in which `idf.py` (and esptool,
 * the IDF python venv, the Xtensa/RISC-V toolchain) work. Two tiers, mirroring
 * how the nRF side trusts the nRF Connect extension's terminal:
 *
 *   Tier 1 — Espressif "ESP-IDF" VS Code extension is installed: reuse (or ask
 *   it to create) its already-sourced ESP-IDF terminal and run bare `idf.py …`.
 *   We never depend on the extension's *internal* APIs for correctness — if its
 *   terminal command is unavailable we fall through to Tier 2.
 *
 *   Tier 2 — no extension: create our own terminal and make every command
 *   self-sourcing (`. "$IDF_PATH/export.sh" && …`) via idfEnvResolver, resolving
 *   IDF_PATH from the extension setting → IDF_PATH env → well-known dirs. If
 *   IDF_PATH can't be resolved we return an actionable error rather than launch
 *   a broken terminal (the nRF lesson).
 *
 * Like the nRF handler, this bypasses CommandExecutor's shell-integration
 * pipeline by running in a dedicated named terminal.
 */

import * as fs from "node:fs"
import * as vscode from "vscode"
import { buildEspShellCommand, detectShell, idfNotFoundMessage, resolveIdfPath, type SupportedPlatform } from "./idfEnvResolver"

const ESP_TERMINAL_NAME = "ESP-IDF"
/** Marketplace id of the official Espressif ESP-IDF VS Code extension. */
const ESP_IDF_EXTENSION_ID = "espressif.esp-idf-extension"
/** Command the extension contributes to open an env-sourced ESP-IDF terminal. */
const ESP_IDF_CREATE_TERMINAL_CMD = "espIdf.createIdfTerminal"

/** Narrow the host's `process.platform` to the resolver's supported set. */
export function hostPlatform(): SupportedPlatform {
	if (process.platform === "win32") return "win32"
	if (process.platform === "darwin") return "darwin"
	return "linux"
}

/** Whether a terminal name looks like one of ours / an ESP-IDF terminal. */
function isEspTerminalName(name: string): boolean {
	const n = name.toLowerCase()
	return n.includes("esp-idf") || n.includes("espressif") || n === "esp" || n.startsWith("esp ")
}

/** First existing ESP-IDF terminal, or undefined (we never fall back to a random shell). */
export function findEspTerminal(): vscode.Terminal | undefined {
	for (const t of vscode.window.terminals) {
		if (isEspTerminalName(t.name)) {
			return t
		}
	}
	return undefined
}

/** Whether the official Espressif ESP-IDF extension is installed. */
export function isEspIdfExtensionInstalled(): boolean {
	return !!vscode.extensions.getExtension(ESP_IDF_EXTENSION_ID)
}

/**
 * Resolve IDF_PATH on the host: the Espressif extension's `idf.espIdfPath`
 * setting (Tier 1 hint) → `IDF_PATH` env → well-known install dirs. We read the
 * extension's setting but never invoke its commands here.
 */
export function resolveHostIdfPath(): string | undefined {
	const platform = hostPlatform()
	const cfg = vscode.workspace.getConfiguration("idf")
	const explicit =
		(platform === "win32" ? cfg.get<string>("espIdfPathWin") : undefined) || cfg.get<string>("espIdfPath") || undefined
	return resolveIdfPath(platform, process.env, fs.existsSync, explicit)
}

export interface PreparedEspTerminal {
	terminalName: string
	/** True when the terminal is NOT pre-sourced, so commands must self-source. */
	needsSourcing: boolean
}

/**
 * Get a terminal to run ESP-IDF commands in, choosing the tier:
 *  - Tier 1 (extension installed): reuse an existing ESP-IDF terminal, else ask
 *    the extension to create one. Commands run bare (the terminal is sourced).
 *  - Tier 2 (no extension, or Tier-1 creation failed): our own terminal, with
 *    `needsSourcing: true` so each command self-sources.
 */
export async function prepareEspTerminal(): Promise<PreparedEspTerminal> {
	// Tier 1: prefer the Espressif extension's already-sourced terminal.
	if (isEspIdfExtensionInstalled()) {
		const existing = findEspTerminal()
		if (existing) {
			existing.show()
			return { terminalName: existing.name, needsSourcing: false }
		}
		try {
			await vscode.commands.executeCommand(ESP_IDF_CREATE_TERMINAL_CMD)
			// Poll for the terminal the extension creates (it sources env on startup).
			for (let i = 0; i < 20; i++) {
				await new Promise((r) => setTimeout(r, 500))
				const created = findEspTerminal()
				if (created) {
					created.show()
					return { terminalName: created.name, needsSourcing: false }
				}
			}
		} catch (e) {
			console.warn("[ESP] espIdf.createIdfTerminal unavailable, falling back to self-sourced terminal:", e)
		}
		// Fall through to Tier 2 if the extension couldn't give us a terminal.
	}

	// Tier 2: our own terminal; commands self-source the IDF env.
	const existing = findEspTerminal()
	if (existing) {
		existing.show()
		return { terminalName: existing.name, needsSourcing: true }
	}
	const terminal = vscode.window.createTerminal({ name: ESP_TERMINAL_NAME })
	terminal.show()
	return { terminalName: terminal.name, needsSourcing: true }
}

export interface BuiltEspCommand {
	command?: string
	error?: string
}

/**
 * Shape a raw command `body` (e.g. `idf.py -C "<proj>" build`, `esptool.py
 * flash_id`, a capture-script invocation) for the prepared terminal. When the
 * terminal isn't pre-sourced, resolve IDF_PATH and prepend the export script;
 * on resolution failure return an actionable error instead of a broken command.
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
