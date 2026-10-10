import path from "node:path"
import { String as ProtoString, StringRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { getAccount, hasGroup } from "@/services/adsum/AccountState"
import { FirmwareClient, type FirmwareEntry, FirmwareLockedError } from "@/services/firmware/FirmwareClient"
import {
	defaultFolder,
	downloadFirmware,
	type LocalFirmware,
	listLocalFirmware,
	setReceiptStatus,
} from "@/services/firmware/FirmwareStore"
import { type FirmwareRowState, firmwareRowState } from "@/services/firmware/firmwareRows"
import { ShowMessageType } from "@/shared/proto/host/window"
import type { Controller } from "../index"

/** One rung of one family as the Hardware page draws it: the registry's entry plus what is on disk. */
export interface FirmwareRow {
	entry: FirmwareEntry
	local: LocalFirmware | null
	/** flash · download · register · renew · ask (firmwareRows.ts holds the rules) */
	state: FirmwareRowState
	folder: string
}

export interface FirmwareListResult {
	ok: true
	rows: FirmwareRow[]
	account: { email: string; groups: string[] } | null
}

type FirmwareRequest =
	| { op: "list"; family?: string; id?: string }
	| { op: "download"; id: string; version: string; folder?: string; pick?: boolean }
	| { op: "open-folder"; folder: string }

async function roots(): Promise<string[]> {
	try {
		return (await HostProvider.workspace.getWorkspacePaths({})).paths ?? []
	} catch {
		return []
	}
}

/**
 * [0.5 the firmware lane] The Hardware page's one door to firmware: list the rungs with their states,
 * download one version into the workspace (or a folder the developer picks), open the folder. Request and
 * response are JSON strings; the page draws the state, the host does the work.
 */
export async function firmware(_controller: Controller, request: StringRequest): Promise<ProtoString> {
	let req: FirmwareRequest
	try {
		req = JSON.parse(request.value || "{}") as FirmwareRequest
	} catch {
		return ProtoString.create({ value: JSON.stringify({ ok: false, error: "bad request" }) })
	}
	try {
		if (req.op === "list") {
			return ProtoString.create({ value: JSON.stringify(await list(req.family, req.id)) })
		}
		if (req.op === "download") {
			const ws = (await roots())[0]
			let folder = req.folder
			if (!folder && req.pick) {
				const picked = await HostProvider.window.showOpenDialogue({
					canSelectMany: false,
					canSelectFolders: true,
					openLabel: "Download here",
				})
				const dir = picked.paths?.[0]
				if (!dir) {
					return ProtoString.create({ value: JSON.stringify({ ok: false, cancelled: true }) })
				}
				folder = path.join(dir, req.version)
			}
			const client = new FirmwareClient()
			if (!folder) {
				if (!ws) {
					return ProtoString.create({
						value: JSON.stringify({ ok: false, error: "open a folder first, or choose one" }),
					})
				}
				const m = await client.manifest(req.id)
				const entry = m.firmware.find((f) => f.id === req.id && f.version === req.version)
				folder = defaultFolder(ws, entry ?? { family: null, id: req.id, version: req.version })
			}
			const local = await downloadFirmware(client, req.id, req.version, folder)
			void HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Downloaded ${local.receipt.title} v${local.receipt.version}, licensed to ${local.receipt.licensee}, into ${folder} with its licence file.`,
			})
			return ProtoString.create({ value: JSON.stringify({ ok: true, local }) })
		}
		if (req.op === "open-folder") {
			await HostProvider.workspace.openInFileExplorerPanel({ path: req.folder })
			return ProtoString.create({ value: JSON.stringify({ ok: true }) })
		}
		return ProtoString.create({ value: JSON.stringify({ ok: false, error: "unknown op" }) })
	} catch (e) {
		if (e instanceof FirmwareLockedError) {
			return ProtoString.create({ value: JSON.stringify({ ok: false, locked: true, group: e.group, error: e.message }) })
		}
		return ProtoString.create({ value: JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }) })
	}
}

async function list(family?: string, id?: string): Promise<FirmwareListResult> {
	const client = new FirmwareClient()
	const m = await client.manifest(id).catch(() => ({ firmware: [] as FirmwareEntry[], account: null }))
	const account = getAccount()
	const wsRoots = await roots()
	const locals = listLocalFirmware(wsRoots)
	const ws = wsRoots[0] ?? ""
	const rows: FirmwareRow[] = []
	const seen = new Set<string>()
	for (const entry of m.firmware) {
		if (family && entry.family && entry.family !== family) {
			continue
		}
		const local = locals.find((l) => l.receipt.id === entry.id && l.receipt.version === entry.version) ?? null
		const entitled = entry.entitled || (!!account && hasGroup(entry.group ?? undefined))
		// The receipt follows the account: a group no longer held marks it expired, never deleted.
		if (local) {
			setReceiptStatus(local.folder, entitled ? "active" : "expired")
			local.receipt.status = entitled ? "active" : "expired"
		}
		const state = firmwareRowState({ entitled, group: entry.group, signedIn: !!account, local })
		rows.push({ entry, local, state, folder: local?.folder ?? (ws ? defaultFolder(ws, entry) : "") })
		seen.add(`${entry.id}@${entry.version}`)
	}
	// On disk but no longer listed (offline, or withdrawn): still flashable, said as such.
	for (const l of locals) {
		if (seen.has(`${l.receipt.id}@${l.receipt.version}`)) {
			continue
		}
		rows.push({
			entry: {
				id: l.receipt.id,
				version: l.receipt.version,
				family: l.receipt.family,
				variant: l.receipt.variant,
				rung: l.receipt.rung,
				group: l.receipt.group,
				title: l.receipt.title,
				summary: null,
				min_ext: null,
				security: false,
				released_at: null,
				licence: { id: l.receipt.licence_id, text: null, termMonths: 12 },
				signature: null,
				signed_by: null,
				entitled: l.receipt.status === "active",
				artifacts: l.receipt.artifacts.map((a) => ({ ...a, group: null })),
			},
			local: l,
			state: firmwareRowState({
				entitled: l.receipt.status === "active",
				group: l.receipt.group,
				signedIn: !!getAccount(),
				local: l,
			}),
			folder: l.folder,
		})
	}
	return { ok: true, rows, account: m.account }
}
