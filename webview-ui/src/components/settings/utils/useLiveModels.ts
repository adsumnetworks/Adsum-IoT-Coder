import type { ModelInfo } from "@shared/api"
import { isLiveModelProvider, SHIPPED_MODELS } from "@shared/liveModels"
import { StringRequest } from "@shared/proto/cline/common"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import { useEffect, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"
import { liveModelListeners, liveModelsFor, setLiveModels } from "./liveModelStore"

/**
 * Ask the extension for the provider's live list whenever the provider or its credentials change, and
 * re-render when it arrives. Returns the list to offer: the shipped table until then, and for good if the
 * call fails (the extension logs why; the developer sees the list they always had). Undefined for a
 * provider without a live list.
 */
export function useLiveModels(provider: string | undefined, credentialsKey?: string): Record<string, ModelInfo> | undefined {
	const [, setVersion] = useState(0)

	useEffect(() => {
		const onChange = () => setVersion((v) => v + 1)
		liveModelListeners.add(onChange)
		return () => {
			liveModelListeners.delete(onChange)
		}
	}, [])

	useEffect(() => {
		if (!isLiveModelProvider(provider)) {
			return
		}
		let cancelled = false
		ModelsServiceClient.refreshDirectProviderModels(StringRequest.create({ value: provider }))
			.then((response) => {
				if (!cancelled) {
					setLiveModels(provider, SHIPPED_MODELS[provider], fromProtobufModels(response.models ?? {}))
				}
			})
			.catch((error) => console.error(`Could not refresh the ${provider} model list:`, error))
		return () => {
			cancelled = true
		}
	}, [provider, credentialsKey])

	return isLiveModelProvider(provider) ? liveModelsFor(provider, SHIPPED_MODELS[provider]) : undefined
}
