/**
 * Engine configuration export — hand the headless core the provider this extension is actually configured with.
 *
 * The headless host (`src/standalone/cline-core.ts`) reads its settings and secrets from plain JSON files under
 * `<CLINE_DIR>/data/`. In VS Code those same values live in `context.globalState` and the OS keychain. Nothing
 * connected the two, so every headless runner invented its own provider config from a model string — and then
 * measured an agent no developer was actually running. This module is the bridge, and it is deliberately pure:
 * no `vscode` import, so the split and the write can be tested under node:test.
 *
 * Two rules, stated once:
 *
 *  1. EXPORT SETTINGS, NEVER GLOBAL STATE. `taskHistory`, `userInfo`, `workspaceRoots`, every nudge counter and
 *     `demoAutoStart` are global state and must not cross into a headless run. The one named exception is
 *     `adsum.installId`: it is the free tier's credential (the proxy takes the install id as its API key), so a
 *     headless run without it would mint a fresh id and draw on a different quota than the developer's.
 *  2. VALUES NEVER LEAVE THE MACHINE, NAMES MAY. The provenance record beside the files carries key NAMES and
 *     counts so a runner can say "adopted from IoT Coder 0.3.1 · zai-coding-plan · 2 keys" — never a value.
 */

import { adsumFreeDefaultModelId } from "@shared/api"
import { isSecretKey, isSettingsKey } from "@shared/storage/state-keys"
import * as fs from "fs"
import * as path from "path"

/** The global-state key the free tier authenticates with. The only non-settings key this export carries. */
export const INSTALL_ID_KEY = "adsum.installId"

/** Secrets that are meaningless, or dangerous, in a headless run. */
const SKIPPED_SECRETS = new Set(["authNonce", "mcpOAuthSecrets"])

/**
 * Operating settings a headless run needs beyond the API configuration. Each one is a `SettingsKey`; the
 * export asserts that rather than trusting this list, so a renamed key fails loudly instead of leaking.
 */
export const EXPORTED_OPERATING_KEYS = [
	"mode",
	"openaiReasoningEffort",
	"preferredLanguage",
	"enableCheckpointsSetting",
	"shellIntegrationTimeout",
	"terminalOutputLineLimit",
	"maxConsecutiveMistakes",
	"strictPlanModeEnabled",
	"useAutoCondense",
	"autoCondenseThreshold",
	"focusChainSettings",
	"browserSettings",
	"defaultTerminalProfile",
] as const

/** Provider id → the act-mode settings key that names its model. Anything absent falls back to `actModeApiModelId`. */
const MODEL_ID_KEY_BY_PROVIDER: Record<string, string> = {
	openrouter: "actModeOpenRouterModelId",
	openai: "actModeOpenAiModelId",
	ollama: "actModeOllamaModelId",
	lmstudio: "actModeLmStudioModelId",
	litellm: "actModeLiteLlmModelId",
	requesty: "actModeRequestyModelId",
	together: "actModeTogetherModelId",
	fireworks: "actModeFireworksModelId",
	groq: "actModeGroqModelId",
	huggingface: "actModeHuggingFaceModelId",
	baseten: "actModeBasetenModelId",
	"vercel-ai-gateway": "actModeVercelAiGatewayModelId",
	sapaicore: "actModeSapAiCoreModelId",
	"huawei-cloud-maas": "actModeHuaweiCloudMaasModelId",
	oca: "actModeOcaModelId",
}

export interface EngineConfigBundle {
	settings: Record<string, unknown>
	secrets: Record<string, string>
	provider: string | null
	model: string | null
}

/**
 * Split a live API configuration into what the headless core's two stores expect. Mirrors the categorisation in
 * `StateManager.setApiConfiguration()` exactly, so this can never disagree with the extension's own notion of
 * "the API configuration". Empty strings are treated as absent: a blank key field is not a key.
 */
export function buildEngineConfig(input: {
	apiConfiguration: Record<string, unknown>
	operating?: Record<string, unknown>
	installId?: string | null
}): EngineConfigBundle {
	const settings: Record<string, unknown> = {}
	const secrets: Record<string, string> = {}

	for (const [key, value] of Object.entries(input.apiConfiguration)) {
		if (value === undefined || value === null || value === "") {
			continue
		}
		if (isSecretKey(key)) {
			if (!SKIPPED_SECRETS.has(key) && typeof value === "string") {
				secrets[key] = value
			}
		} else if (isSettingsKey(key)) {
			settings[key] = value
		}
		// Anything else is global state and stays behind — see rule 1.
	}

	for (const [key, value] of Object.entries(input.operating ?? {})) {
		if (value === undefined || value === null) {
			continue
		}
		if (!isSettingsKey(key)) {
			throw new Error(`engine config export: "${key}" is not a settings key — only settings cross into a headless run`)
		}
		settings[key] = value
	}

	if (input.installId) {
		settings[INSTALL_ID_KEY] = input.installId
	}

	const provider = typeof settings.actModeApiProvider === "string" ? settings.actModeApiProvider : null
	return { settings, secrets, provider, model: modelFor(provider, settings) }
}

function modelFor(provider: string | null, settings: Record<string, unknown>): string | null {
	if (!provider) {
		return null
	}
	if (provider === "adsum-free") {
		// The free tier has exactly one model and no model-id setting; say which so a run is attributable.
		return adsumFreeDefaultModelId
	}
	const specific = MODEL_ID_KEY_BY_PROVIDER[provider]
	const candidates = [specific ? settings[specific] : undefined, settings.actModeApiModelId]
	const hit = candidates.find((c) => typeof c === "string" && c.length > 0)
	return typeof hit === "string" ? hit : null
}

export interface EngineConfigProvenance {
	writtenAt: string
	extensionId: string
	extensionVersion: string | null
	editor: string | null
	remote: string | null
	host: string
	provider: string | null
	model: string | null
	settingsKeys: number
	secretKeys: string[]
}

export const PROVENANCE_FILE = "engine-config.provenance.json"

/**
 * Write the bundle into a headless data dir. MERGES: an existing `globalState.json` or `secrets.json` keeps every
 * key this export does not own, so adopting a provider never wipes a runner's own harness overrides. Files are
 * mode 0600, the same as the standalone stores themselves write.
 */
export function writeEngineConfig(
	dataDir: string,
	bundle: EngineConfigBundle,
	meta: Omit<EngineConfigProvenance, "writtenAt" | "provider" | "model" | "settingsKeys" | "secretKeys">,
): { dataDir: string; provenance: EngineConfigProvenance } {
	fs.mkdirSync(dataDir, { recursive: true })
	mergeJson(path.join(dataDir, "globalState.json"), bundle.settings)
	mergeJson(path.join(dataDir, "secrets.json"), bundle.secrets)

	const provenance: EngineConfigProvenance = {
		writtenAt: new Date().toISOString(),
		...meta,
		provider: bundle.provider,
		model: bundle.model,
		settingsKeys: Object.keys(bundle.settings).length,
		secretKeys: Object.keys(bundle.secrets).sort(),
	}
	fs.writeFileSync(path.join(dataDir, PROVENANCE_FILE), JSON.stringify(provenance, null, 2), { mode: 0o600 })
	return { dataDir, provenance }
}

function mergeJson(file: string, updates: Record<string, unknown>): void {
	let existing: Record<string, unknown> = {}
	if (fs.existsSync(file)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				existing = parsed
			}
		} catch {
			// An unreadable store is replaced, not propagated: the runner would fail on it anyway.
		}
	}
	fs.writeFileSync(file, JSON.stringify({ ...existing, ...updates }, null, 2), { mode: 0o600 })
	// writeFileSync only applies `mode` on creation; an existing file keeps whatever it had. Make it true either way.
	try {
		fs.chmodSync(file, 0o600)
	} catch {
		// Windows has no POSIX mode bits; nothing to do.
	}
}

/** Read the provenance of a previous export, or null when none exists. Values are never in it, so this is safe to show. */
export function readEngineConfigProvenance(dataDir: string): EngineConfigProvenance | null {
	try {
		return JSON.parse(fs.readFileSync(path.join(dataDir, PROVENANCE_FILE), "utf8"))
	} catch {
		return null
	}
}
