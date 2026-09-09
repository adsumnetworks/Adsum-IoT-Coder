import { EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import { ClineEnv } from "@/config"
import { getSessionToken, signOut } from "@/services/adsum/AccountState"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import type { Controller } from ".."

/**
 * Delete the account.
 *
 * Irreversible, and the panel says so before calling this. The local sign-out happens either way:
 * if the server deleted the account, the bearer is already dead, and holding on to it would leave the
 * editor believing in a session that no longer exists.
 */
export async function deleteAccount(controller: Controller, _request: EmptyRequest): Promise<ProtoString> {
	const token = getSessionToken()
	if (!token) {
		return ProtoString.create({ value: "" })
	}
	const base = ClineEnv.config().adsumApiBaseUrl.replace(/\/$/, "")
	try {
		const res = await fetch(`${base}/v1/me`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
		if (!res.ok && res.status !== 401) {
			// A failure here must NOT sign them out: they would think it worked.
			Logger.warn(`[account] delete failed: ${res.status}`)
			return ProtoString.create({ value: `That didn’t go through (${res.status}). Nothing was deleted.` })
		}
	} catch (e) {
		Logger.warn(`[account] delete threw: ${e instanceof Error ? e.message : String(e)}`)
		return ProtoString.create({ value: "Adsum can’t be reached right now. Nothing was deleted." })
	}
	// Counted only once the server has confirmed: a refused delete is not a deletion.
	telemetryService.captureAccountDeleted()
	await signOut()
	await controller.postStateToWebview()
	return ProtoString.create({ value: "" })
}
