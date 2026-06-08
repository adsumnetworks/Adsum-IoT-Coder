import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import { createHash } from "crypto"
import { machineId } from "node-machine-id"
import { ClineEnv } from "@/config"
import { persistCachedFreeTokensRemaining } from "@/services/adsum/FreeTierState"
import { getInstallId } from "@/services/adsum/InstallIdentity"
import { telemetryService } from "@/services/telemetry"
import { Controller } from ".."

/** Normalized invite-code redemption result returned to the webview as JSON. */
export interface RedeemResult {
	grantedTokens: number
	newQuota: number
	sourceLabel: string
}

/**
 * Redeems an invite code against the Adsum backend.
 * Computes the per-device user_key host-side (sha256 of machineId) so no raw
 * device id is sent and the anti-abuse gate is server-enforced.
 * Returns a JSON-encoded RedeemResult on success; throws a human-readable
 * message on failure (mapped from backend error codes).
 */
export async function redeemInviteCode(_controller: Controller, request: StringRequest): Promise<ProtoString> {
	const code = request.value?.trim() ?? ""
	if (!code) {
		throw new Error("Enter an invite code.")
	}

	const installId = getInstallId()
	const baseUrl = ClineEnv.config().adsumApiBaseUrl

	// Derive stable per-device key for the abuse gate — survives reinstalls and
	// "Reset Global State" (which mint a new install_id but not a new machineId).
	const rawMachineId = await machineId()
	const userKey = createHash("sha256").update(rawMachineId).digest("hex")

	let res: Response
	try {
		res = await fetch(`${baseUrl}/v1/redeem-code`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ install_id: installId, user_key: userKey, code }),
		})
	} catch {
		throw new Error("Network error — check your connection and try again.")
	}

	if (!res.ok) {
		const body: { error?: string } = await res.json().catch(() => ({}))
		const reason = body.error ?? res.status.toString()
		telemetryService.captureFreeTierInviteCodeFailed(installId, reason)
		switch (reason) {
			case "unknown_code":
				throw new Error("That code wasn't found. Check for typos.")
			case "expired":
				throw new Error("This code has expired.")
			case "code_exhausted":
				throw new Error("This code has reached its redemption limit.")
			case "already_redeemed":
				throw new Error("You've already redeemed this code.")
			default:
				throw new Error("Redemption failed — try again later.")
		}
	}

	const body: { granted_tokens?: number; new_quota?: number; source_label?: string } = await res.json()
	const grantedTokens = body.granted_tokens ?? 0
	const newQuota = body.new_quota ?? 0
	const sourceLabel = body.source_label ?? ""

	// Immediately refresh the in-memory + persisted quota so the token chip updates.
	persistCachedFreeTokensRemaining(newQuota)

	telemetryService.captureFreeTierInviteCodeRedeemed(installId, code, grantedTokens, sourceLabel)

	const result: RedeemResult = { grantedTokens, newQuota, sourceLabel }
	return ProtoString.create({ value: JSON.stringify(result) })
}
