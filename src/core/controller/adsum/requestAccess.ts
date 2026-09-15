import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import { ClineEnv } from "@/config"
import { getSessionToken } from "@/services/adsum/AccountState"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import type { Controller } from ".."

/**
 * Ask for access to a family's template source.
 *
 * Needing an account IS the anti-spam measure, together with the database's one-open-request-per-
 * family index — so a second tab cannot open a second request, and the panel is told which case it
 * hit rather than being shown a generic failure.
 */
export async function requestAccess(controller: Controller, request: StringRequest): Promise<ProtoString> {
	const reply = (v: Record<string, unknown>) => ProtoString.create({ value: JSON.stringify(v) })
	const token = getSessionToken()
	if (!token) {
		return reply({ ok: false, reason: "not_signed_in" })
	}
	let body: { family?: string; chips?: string[]; message?: string }
	try {
		body = JSON.parse(request.value || "{}")
	} catch {
		return reply({ ok: false, reason: "bad_request" })
	}
	const base = ClineEnv.config().adsumApiBaseUrl.replace(/\/$/, "")
	try {
		const res = await fetch(`${base}/v1/access-requests`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ family: body.family, chips: body.chips ?? [], message: body.message ?? "" }),
		})
		if (res.status === 409) {
			// Two tabs, or a second ask before we answered the first. Not a failure to apologise for.
			return reply({ ok: false, reason: "already_open" })
		}
		if (res.status === 400) {
			// The server refuses an option that names no group on this family rather than filing an
			// empty request; the form must say that, not "try again", or the developer retries a thing
			// that can never send. [15 Sep 2026]
			const detail = await res.text().catch(() => "")
			if (/no known group/i.test(detail)) {
				return reply({ ok: false, reason: "unknown_option" })
			}
			return reply({ ok: false, reason: "http_400" })
		}
		if (!res.ok) {
			return reply({ ok: false, reason: `http_${res.status}` })
		}
		telemetryService.captureAccessRequested({ family: String(body.family ?? ""), chips: (body.chips ?? []).join(",") })
		await controller.postStateToWebview()
		return reply({ ok: true })
	} catch (e) {
		Logger.warn(`[account] access request failed: ${e instanceof Error ? e.message : String(e)}`)
		return reply({ ok: false, reason: "offline" })
	}
}
