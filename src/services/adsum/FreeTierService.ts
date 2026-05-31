import { ClineEnv } from "@/config"
import { telemetryService } from "@/services/telemetry"
import { setCachedFreeTokensRemaining } from "./FreeTierState"
import { getInstallId } from "./InstallIdentity"

const REGISTERED_KEY = "adsum.freeTierRegistered"
const REMAINING_KEY = "adsum.freeTokensRemaining"

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
	const installId = getInstallId()
	const baseUrl = ClineEnv.config().adsumApiBaseUrl

	try {
		// Always call register-install (idempotent upsert) to get fresh quota on every launch.
		// On first call it creates the account; on subsequent calls it just returns current quota.
		const res = await fetch(`${baseUrl}/v1/register-install`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ install_id: installId }),
		})

		if (res.ok) {
			const body: { quota?: number; tokens_used?: number } = await res.json().catch(() => ({}))
			if (body.quota !== undefined && body.tokens_used !== undefined) {
				const remaining = Math.max(0, body.quota - body.tokens_used)
				setCachedFreeTokensRemaining(remaining)
				await globalState.update(REMAINING_KEY, remaining)
			}
			if (!alreadyRegistered) {
				await globalState.update(REGISTERED_KEY, true)
				telemetryService.captureFreeTierInstallRegistered(installId)
				console.log("[adsum] install registered with free-tier proxy")
			}
		} else {
			console.warn(`[adsum] register-install failed: ${res.status}`)
		}
	} catch (err) {
		console.warn("[adsum] register-install network error:", err)
	}
}

/**
 * Seeds FreeTierState from the last-persisted remaining-quota value.
 * Call on every activation so the chip shows before the first API response.
 */
export function loadCachedQuota(globalState: { get: (key: string) => unknown }): void {
	const stored = globalState.get(REMAINING_KEY)
	if (typeof stored === "number") {
		setCachedFreeTokensRemaining(stored)
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
