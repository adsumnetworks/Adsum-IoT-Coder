import type { ModelInfo } from "@shared/api"
import { isLiveModelProvider, type LiveModelProvider, withoutRetired } from "@shared/liveModels"

/**
 * The model list each direct provider serves now, as the extension reconciled it (liveModelLists.ts).
 *
 * One store for the whole webview, so the settings panel, the chat model picker and
 * normalizeApiConfiguration agree on which ids exist. Until an answer arrives — or when the call fails —
 * every reader gets the shipped table, which is exactly what they had before.
 */
const store = new Map<LiveModelProvider, Record<string, ModelInfo>>()
/** Called whenever a provider's list changes. */
export const liveModelListeners = new Set<() => void>()

/** The live list for a provider, or the shipped table when there is none yet. */
export function liveModelsFor(provider: string, shipped: Record<string, ModelInfo>): Record<string, ModelInfo> {
	// Retired ids are never offered, even before a live list arrives (see RETIRED_MODEL_IDS).
	return (isLiveModelProvider(provider) && store.get(provider)) || withoutRetired(provider, shipped)
}

/**
 * Keep the shipped info (full fidelity, same code) for ids the table knows; take the extension's
 * conservative info for the ones it does not.
 */
export function setLiveModels(
	provider: LiveModelProvider,
	shipped: Record<string, ModelInfo>,
	received: Record<string, ModelInfo>,
): void {
	const ids = Object.keys(received)
	if (ids.length === 0) {
		return
	}
	store.set(provider, Object.fromEntries(ids.map((id) => [id, shipped[id] ?? received[id]])))
	for (const listener of liveModelListeners) {
		listener()
	}
}

/** Visible for tests. */
export function resetLiveModels(): void {
	store.clear()
}
