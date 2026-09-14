import { isLiveModelProvider, LIVE_MODEL_PROVIDERS, type LiveModelProvider, SHIPPED_MODELS } from "@shared/liveModels"
import type { StringRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { type LiveModelRequest, refreshLiveModelList } from "@/core/api/models/liveModelLists"
import type { StateManager } from "@/core/storage/StateManager"
import { toProtobufModels } from "../../../shared/proto-conversions/models/typeConversion"
import type { Controller } from ".."

/**
 * The models a direct provider serves now, reconciled with the shipped list (see liveModelLists.ts).
 * `request.value` names the provider. An unknown provider, a missing key or a failed call all return the
 * shipped list (or nothing, for a provider with no list), never an error.
 */
/** What a provider's list request needs, read from the saved settings. Keys are read, never cached. */
export function liveRequestFor(
	provider: LiveModelProvider,
	state: Pick<StateManager, "getSecretKey" | "getGlobalSettingsKey">,
): LiveModelRequest {
	return {
		provider,
		apiKey:
			provider === "deepseek"
				? state.getSecretKey("deepSeekApiKey")
				: provider === "anthropic"
					? state.getSecretKey("apiKey")
					: state.getSecretKey("zaiApiKey"),
		anthropicBaseUrl: provider === "anthropic" ? state.getGlobalSettingsKey("anthropicBaseUrl") : undefined,
		zaiApiLine: provider === "zai-coding-plan" ? state.getGlobalSettingsKey("zaiApiLine") : undefined,
	}
}

/**
 * At startup, ask every direct provider that has a saved key which models it serves, so the first request
 * and the first open of the picker already see the live list rather than the shipped one. A provider with
 * no key is not asked. Never throws; each failure keeps the shipped list (see liveModelLists.ts). The picker
 * and the settings panel still ask again when opened — within the cache lifetime that answer is the cached one.
 */
export async function warmLiveModelLists(
	state: Pick<StateManager, "getSecretKey" | "getGlobalSettingsKey">,
	refresh: typeof refreshLiveModelList = refreshLiveModelList,
): Promise<LiveModelProvider[]> {
	const asked: LiveModelProvider[] = []
	await Promise.all(
		LIVE_MODEL_PROVIDERS.map(async (provider) => {
			const request = liveRequestFor(provider, state)
			if (!request.apiKey?.trim()) return
			asked.push(provider)
			try {
				await refresh(request, SHIPPED_MODELS[provider])
			} catch {
				// refreshLiveModelList never throws; this is belt and braces for startup.
			}
		}),
	)
	return asked.sort()
}

export async function refreshDirectProviderModels(
	controller: Controller,
	request: StringRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const provider = request.value
	if (!isLiveModelProvider(provider)) {
		return OpenRouterCompatibleModelInfo.create({ models: {} })
	}
	const models = await refreshLiveModelList(liveRequestFor(provider, controller.stateManager), SHIPPED_MODELS[provider])
	return OpenRouterCompatibleModelInfo.create({ models: toProtobufModels(models) })
}
