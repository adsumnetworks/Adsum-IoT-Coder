import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { type FirmwareClient, type FirmwareEntry, FirmwareLockedError } from "./FirmwareClient"

/**
 * [0.5 the firmware lane] Where licensed firmware lives on this machine: in the workspace, in a folder the
 * developer chose, with its licence and its receipt beside it. Never in globalStorage, never in a cache
 * another process reads, never handed to the agent as bytes.
 */
export const RECEIPT_FILE = "adsum-firmware.json"
export const LICENCE_FILE = "LICENSE-ADSUM.txt"

export interface ReceiptArtifact {
	path: string
	sha256: string
	size: number
}

export interface FirmwareReceipt {
	id: string
	version: string
	family: string | null
	variant: string | null
	rung: string | null
	group: string | null
	title: string
	artifacts: ReceiptArtifact[]
	licensee: string
	licence_id: string
	term_start: string
	term_end: string
	watermark_id: string
	downloaded_at: string
	/** active, or expired once the account no longer holds the group. The files are never deleted. */
	status: "active" | "expired"
	status_checked_at?: string
}

export interface LocalFirmware {
	folder: string
	receipt: FirmwareReceipt
	/** Every artifact present with the right hash. */
	intact: boolean
}

export const sha256 = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex")

/** The default home: `firmware/<family>/<version>/` under the workspace root. */
export function defaultFolder(root: string, entry: Pick<FirmwareEntry, "family" | "id" | "version">): string {
	const family = (entry.family || entry.id.split("/").pop() || "firmware").replace(/[^A-Za-z0-9._-]+/g, "-")
	return path.join(root, "firmware", family, entry.version)
}

function addMonths(iso: string, months: number): string {
	const d = new Date(iso)
	d.setMonth(d.getMonth() + months)
	return d.toISOString()
}

/**
 * The licence file's text: who it is licensed to, the term and the watermark, then the licence itself, in
 * the words the bundle ships (its own LICENSE-ADSUM.txt), else the registry's, else the template's summary.
 */
export function licenceText(
	entry: FirmwareEntry,
	licensee: string,
	termStart: string,
	termEnd: string,
	watermark: string,
	bundleText?: string,
): string {
	const head = [
		`${entry.title} · ${entry.id} ${entry.version}`,
		`Licensed to: ${licensee}`,
		`Licence: ${entry.licence.id}`,
		`Update term: ${termStart.slice(0, 10)} to ${termEnd.slice(0, 10)} (versions published inside the term are covered; what is held stays usable after it)`,
		`Watermark: ${watermark}`,
		"",
	].join("\n")
	const body =
		bundleText?.trim() ||
		entry.licence.text ||
		[
			"Adsum Template Licence (summary; ask Adsum Networks for the full text: support@adsumnetworks.com).",
			"",
			"This firmware and any source beside it are licensed, not sold, to the organisation named above for use on",
			"its own products. It may be flashed onto that organisation's units without limit and modified where it is",
			"delivered as source. It may not be redistributed, published, or passed to a third party in any form, and the",
			"licence, receipt and watermark files beside it must travel with every copy kept. Security releases inside the",
			"support period are available to every holder. The licence may be revoked for breach; a revocation ends the",
			"right to download, never the right to keep running what was already delivered.",
		].join("\n")
	return `${head}${body}\n`
}

/** Scans the workspace roots for receipts: `firmware/<family>/<version>/adsum-firmware.json`. */
export function listLocalFirmware(roots: readonly string[]): LocalFirmware[] {
	const out: LocalFirmware[] = []
	for (const root of roots) {
		const base = path.join(root, "firmware")
		if (!existsSync(base)) {
			continue
		}
		let families: string[] = []
		try {
			families = readdirSync(base)
		} catch {
			continue
		}
		for (const fam of families) {
			const famDir = path.join(base, fam)
			let versions: string[] = []
			try {
				if (!statSync(famDir).isDirectory()) continue
				versions = readdirSync(famDir)
			} catch {
				continue
			}
			for (const v of versions) {
				const folder = path.join(famDir, v)
				const local = readLocal(folder)
				if (local) {
					out.push(local)
				}
			}
		}
	}
	return out
}

export function readLocal(folder: string): LocalFirmware | null {
	const receiptPath = path.join(folder, RECEIPT_FILE)
	if (!existsSync(receiptPath)) {
		return null
	}
	try {
		const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as FirmwareReceipt
		const intact = (receipt.artifacts ?? []).every((a) => {
			const p = path.join(folder, a.path)
			return existsSync(p) && sha256(readFileSync(p)) === a.sha256
		})
		return { folder, receipt, intact }
	} catch {
		return null
	}
}

/**
 * Downloads one firmware version into `folder`: authorise (fresh), fetch each file under the token, verify
 * every hash, write into a staging folder, then rename it into place. Either everything lands or nothing does.
 */
export async function downloadFirmware(
	client: FirmwareClient,
	id: string,
	version: string,
	folder: string,
): Promise<LocalFirmware> {
	const auth = await client.authorise(id, version)
	const entry = auth.firmware
	if (!entry.artifacts.length) {
		throw new FirmwareLockedError(entry.group, "nothing in this version is open to this account")
	}
	const parent = path.dirname(folder)
	mkdirSync(parent, { recursive: true })
	const staging = path.join(parent, `.${path.basename(folder)}.downloading-${randomBytes(4).toString("hex")}`)
	mkdirSync(staging, { recursive: true })
	try {
		const artifacts: ReceiptArtifact[] = []
		// The bundle's own licence file is folded into the one written below, which names the licensee: two
		// files with one name would leave the folder looking tampered with the moment it lands.
		let bundleLicence: string | undefined
		for (const a of entry.artifacts) {
			const bytes = await client.artifact(a.sha256, auth.token, a.path)
			const got = sha256(bytes)
			if (got !== a.sha256) {
				throw new Error(`${a.path}: the bytes do not match their hash (${got.slice(0, 12)} vs ${a.sha256.slice(0, 12)})`)
			}
			if (a.path === LICENCE_FILE) {
				bundleLicence = bytes.toString("utf8")
				continue
			}
			const dest = path.join(staging, a.path)
			if (!path.resolve(dest).startsWith(path.resolve(staging) + path.sep)) {
				throw new Error(`${a.path}: refuses to write outside the firmware folder`)
			}
			mkdirSync(path.dirname(dest), { recursive: true })
			writeFileSync(dest, bytes)
			artifacts.push({ path: a.path, sha256: a.sha256, size: bytes.length })
		}
		// The term is the developer's: it runs from the download, not from the day the version was released.
		const now = new Date().toISOString()
		const termStart = now
		const termEnd = addMonths(termStart, entry.licence.termMonths || 12)
		const watermark = sha256(Buffer.from(`${auth.licensee}|${entry.id}|${entry.version}`)).slice(0, 16)
		const receipt: FirmwareReceipt = {
			id: entry.id,
			version: entry.version,
			family: entry.family,
			variant: entry.variant,
			rung: entry.rung,
			group: entry.group,
			title: entry.title,
			artifacts,
			licensee: auth.licensee,
			licence_id: entry.licence.id,
			term_start: termStart,
			term_end: termEnd,
			watermark_id: watermark,
			downloaded_at: now,
			status: "active",
		}
		const licence = Buffer.from(licenceText(entry, auth.licensee, termStart, termEnd, watermark, bundleLicence))
		writeFileSync(path.join(staging, LICENCE_FILE), licence)
		// The receipt records what is on disk, so the folder reads intact; the registry hash was checked above.
		receipt.artifacts.push({ path: LICENCE_FILE, sha256: sha256(licence), size: licence.length })
		writeFileSync(path.join(staging, RECEIPT_FILE), `${JSON.stringify(receipt, null, 2)}\n`)
		if (existsSync(folder)) {
			// A re-download replaces the folder whole; nothing half-old, half-new.
			rmSync(folder, { recursive: true, force: true })
		}
		renameSync(staging, folder)
		return { folder, receipt, intact: true }
	} catch (e) {
		rmSync(staging, { recursive: true, force: true })
		throw e
	}
}

/**
 * What a receipt's status is now: active while the account still holds the group AND the term has not
 * ended; expired otherwise. Either way the files stay and still flash; the word only says what Download
 * and the licence line should say.
 */
export function receiptStatusNow(
	receipt: Pick<FirmwareReceipt, "term_end">,
	entitled: boolean,
	now: Date = new Date(),
): FirmwareReceipt["status"] {
	const end = receipt.term_end ? new Date(receipt.term_end) : null
	const ended = end !== null && !Number.isNaN(end.getTime()) && end.getTime() <= now.getTime()
	return entitled && !ended ? "active" : "expired"
}

/** Marks a receipt expired (or active again) after the account has been re-read. The files stay. */
export function setReceiptStatus(folder: string, status: FirmwareReceipt["status"]): void {
	const p = path.join(folder, RECEIPT_FILE)
	try {
		const receipt = JSON.parse(readFileSync(p, "utf8")) as FirmwareReceipt
		if (receipt.status !== status) {
			receipt.status = status
			receipt.status_checked_at = new Date().toISOString()
			writeFileSync(p, `${JSON.stringify(receipt, null, 2)}\n`)
		}
	} catch {
		// a hand-edited receipt is left alone
	}
}

/** The one line the agent prints before a flash, and the audit trail in the transcript. */
export function flashLine(local: LocalFirmware, artifactPath?: string): string {
	const r = local.receipt
	const file = artifactPath ? path.join(local.folder, artifactPath) : local.folder
	return `Flashing ${r.title} v${r.version}, licensed to ${r.licensee}, from ${file}`
}
