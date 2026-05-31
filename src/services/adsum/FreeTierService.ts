import { ClineEnv } from "@/config"
import { telemetryService } from "@/services/telemetry"
import { getInstallId } from "./InstallIdentity"

const REGISTERED_KEY = "adsum.freeTierRegistered"

/**
 * Registers this install with the Adsum free-tier proxy.
 * Safe to call on every activation — the backend is idempotent (upsert).
 * Only fires a network request the first time (persists flag in global state).
 */
export async function registerInstallIfNeeded(globalState: {
	get: (key: string) => unknown
	update: (key: string, value: unknown) => Thenable<void>
}): Promise<void> {
	const alreadyRegistered = globalState.get(REGISTERED_KEY)
	if (alreadyRegistered) {
		return
	}

	const installId = getInstallId()
	const baseUrl = ClineEnv.config().adsumApiBaseUrl

	try {
		const res = await fetch(`${baseUrl}/v1/register-install`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ install_id: installId }),
		})

		if (res.ok) {
			await globalState.update(REGISTERED_KEY, true)
			telemetryService.captureFreeTierInstallRegistered(installId)
			console.log("[adsum] install registered with free-tier proxy")
		} else {
			// Non-fatal — will retry on next activation
			console.warn(`[adsum] register-install failed: ${res.status}`)
		}
	} catch (err) {
		// Network error — non-fatal, will retry next activation
		console.warn("[adsum] register-install network error:", err)
	}
}

/**
 * Checks if a new install should default to the adsum-free provider.
 * Returns true only when:
 *  - The free-tier-stage0 feature flag is on
 *  - The user hasn't already configured a provider (no existing apiProvider in state)
 */
export function shouldDefaultToFreeTier(freeTierFlagEnabled: boolean, hasExistingApiProvider: boolean): boolean {
	return freeTierFlagEnabled && !hasExistingApiProvider
}
