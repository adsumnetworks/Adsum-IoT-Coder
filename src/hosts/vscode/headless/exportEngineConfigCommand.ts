/** "Adsum: Export engine configuration…" — give a headless run the provider this extension is configured with.
 *
 *  The headless core reads plain JSON under `<CLINE_DIR>/data/`; this extension keeps the same values in VS Code's
 *  global state and the OS keychain. Without this command a headless runner has to invent a provider, and then it
 *  measures an agent nobody is actually running. With it, the installed extension is the source of truth: whatever
 *  the developer set up here is exactly what the headless run uses.
 *
 *  The write is confirmed host-side with a modal that names the path and the number of keys. Never a webview
 *  `confirm()` — those are blocked — and never silently, because the result is a plaintext copy of a provider key
 *  in the developer's home directory.
 */
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { StateManager } from "@/core/storage/StateManager"
import {
	buildEngineConfig,
	EXPORTED_OPERATING_KEYS,
	INSTALL_ID_KEY,
	writeEngineConfig,
} from "@/services/headless/EngineConfigExport"

export interface ExportEngineConfigArgs {
	/** Headless data root; `data/` is appended. Defaults to `$CLINE_DIR`, then `~/.cline-adsum-tests`. */
	targetDir?: string
	/** Skip the modal. Honoured ONLY in extension development mode — a headless caller cannot bypass consent. */
	silent?: boolean
}

export interface ExportEngineConfigResult {
	ok: boolean
	dataDir: string
	provider: string | null
	model: string | null
	settingsKeys: number
	/** Key NAMES only. Values never enter this object. */
	secretKeys: string[]
	extensionVersion: string | null
	error?: string
}

export const DEFAULT_HEADLESS_DIR = ".cline-adsum-tests"

export async function exportEngineConfigCommand(
	context: vscode.ExtensionContext,
	args?: ExportEngineConfigArgs,
): Promise<ExportEngineConfigResult> {
	const target = args?.targetDir || process.env.CLINE_DIR || path.join(os.homedir(), DEFAULT_HEADLESS_DIR)
	const dataDir = path.join(target, "data")
	const extensionVersion: string | null = context.extension?.packageJSON?.version ?? null
	const fail = (error: string): ExportEngineConfigResult => ({
		ok: false,
		dataDir,
		provider: null,
		model: null,
		settingsKeys: 0,
		secretKeys: [],
		extensionVersion,
		error,
	})

	let bundle
	try {
		const sm = StateManager.get()
		const operating: Record<string, unknown> = {}
		for (const key of EXPORTED_OPERATING_KEYS) {
			operating[key] = sm.getGlobalSettingsKey(key)
		}
		bundle = buildEngineConfig({
			apiConfiguration: sm.getApiConfiguration() as Record<string, unknown>,
			operating,
			installId: context.globalState.get<string>(INSTALL_ID_KEY) ?? null,
		})
	} catch (e: any) {
		const msg = `Could not read this extension's configuration: ${String(e?.message || e)}`
		vscode.window.showErrorMessage(msg)
		return fail(msg)
	}

	if (!bundle.provider) {
		const msg = "No inference provider is configured in this extension yet — set one up in Settings first."
		vscode.window.showWarningMessage(msg)
		return fail(msg)
	}

	const keyCount = Object.keys(bundle.secrets).length
	const mayBeSilent = args?.silent === true && context.extensionMode === vscode.ExtensionMode.Development
	if (!mayBeSilent) {
		const pick = await vscode.window.showWarningMessage(
			`Write this extension's provider configuration to ${dataDir}?\n\n` +
				`Provider: ${bundle.provider}${bundle.model ? ` · ${bundle.model}` : ""}\n` +
				`${keyCount} provider key${keyCount === 1 ? "" : "s"} will be written as plain text, readable by your user ` +
				`account only (file mode 0600). Anything with read access to your home directory can read them.`,
			{ modal: true },
			"Write configuration",
		)
		if (pick !== "Write configuration") {
			return fail("cancelled")
		}
	}

	try {
		const r = writeEngineConfig(dataDir, bundle, {
			extensionId: context.extension?.id?.toLowerCase() ?? "adsumnetwork.nrf-ai-debugger",
			extensionVersion,
			editor: vscode.env.appName ?? null,
			remote: vscode.env.remoteName ?? null,
			host: os.hostname(),
		})
		vscode.window.showInformationMessage(
			`Engine configuration written to ${dataDir} — ${bundle.provider}${bundle.model ? ` · ${bundle.model}` : ""}, ` +
				`${keyCount} key${keyCount === 1 ? "" : "s"}.`,
		)
		return {
			ok: true,
			dataDir,
			provider: bundle.provider,
			model: bundle.model,
			settingsKeys: r.provenance.settingsKeys,
			secretKeys: r.provenance.secretKeys,
			extensionVersion,
		}
	} catch (e: any) {
		const msg = `Could not write the engine configuration: ${String(e?.message || e)}`
		vscode.window.showErrorMessage(msg)
		return fail(msg)
	}
}
