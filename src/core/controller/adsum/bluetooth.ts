import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import {
	type BleStepResult,
	bleCheckFirmware,
	bleClaim,
	bleForget,
	bleStatus,
	scanBleGateways,
	selectBleGateway,
} from "@/services/blg20/bleGateways"
import { nrfEnvironmentWithBlg20 } from "@/services/blg20/connectedBlg20"
import { getCachedEspEnvironment } from "@/services/esp/EspEnvironmentDetector"
import { setAdsumStatusBarTooltip } from "@/services/statusbar/AdsumStatusBar"
import type { Controller } from "../index"

type BluetoothRequest =
	| { op: "scan" }
	| { op: "select"; target: string }
	| { op: "connect"; target: string; passkey?: string }
	| { op: "claim"; target: string; passkey?: string }
	| { op: "check"; target: string; family: string }
	| { op: "forget"; target: string }

/**
 * [11 Oct 2026] The Hardware page's door to a gateway over Bluetooth, before any session: scan, pick the unit,
 * connect (which pairs the first time), claim, check its firmware against the latest release, forget the pairing.
 * The host runs the service tool for each step; the page draws the facts from the state that follows. Request and
 * response are JSON strings, like the firmware door.
 */
export async function bluetooth(controller: Controller, request: StringRequest): Promise<ProtoString> {
	let req: BluetoothRequest
	try {
		req = JSON.parse(request.value || "{}") as BluetoothRequest
	} catch {
		return ProtoString.create({ value: JSON.stringify({ ok: false, error: "bad request" }) })
	}
	const reply = (r: BleStepResult | { ok: boolean; words?: string; error?: string }) =>
		ProtoString.create({ value: JSON.stringify(r) })
	const refresh = async () => {
		setAdsumStatusBarTooltip(nrfEnvironmentWithBlg20(), getCachedEspEnvironment())
		await controller.postStateToWebview()
	}
	try {
		if (req.op === "scan") {
			const rows = await scanBleGateways("refresh")
			await refresh()
			const n = rows.filter((r) => r.window).length
			return reply({
				ok: true,
				words: n ? `${n} in range` : "no gateway in range: power one up, or hold its button for three seconds",
			})
		}
		if (req.op === "select") {
			selectBleGateway(req.target)
			await refresh()
			return reply({ ok: true })
		}
		if (req.op === "connect") {
			const r = await bleStatus(req.target, req.passkey)
			await refresh()
			return reply(r)
		}
		if (req.op === "claim") {
			const r = await bleClaim(req.target, req.passkey)
			await refresh()
			return reply(r)
		}
		if (req.op === "check") {
			let ws: string | undefined
			try {
				ws = (await HostProvider.workspace.getWorkspacePaths({})).paths?.[0]
			} catch {
				ws = undefined
			}
			const r = await bleCheckFirmware(req.target, req.family, ws)
			await refresh()
			return reply(r)
		}
		if (req.op === "forget") {
			const r = await bleForget(req.target)
			await refresh()
			return reply(r)
		}
		return reply({ ok: false, error: "unknown op" })
	} catch (e) {
		return reply({ ok: false, error: e instanceof Error ? e.message : String(e) })
	}
}
