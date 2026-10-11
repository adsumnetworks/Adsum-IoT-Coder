import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Logger } from "@services/logging/Logger"
import type { Blg20BleRow, Blg20Commission, Blg20Unit } from "@shared/blg20"
import { HostProvider } from "@/hosts/host-provider"
import { getAccount, hasGroup } from "@/services/adsum/AccountState"
import { FirmwareClient, type FirmwareEntry } from "@/services/firmware/FirmwareClient"
import { defaultFolder } from "@/services/firmware/FirmwareStore"
import { holderOf } from "@/services/hardware/HardwarePortGuard"
import { resolveToolAsync } from "@/services/tools/ToolResolver"

/**
 * Gateways seen over Bluetooth: the LBG20x's only service port (its USB-C carries power, not data), and the BLG20x's
 * second one from firmware 0.3.6.
 *
 * The scan is the service tool's own `list --ble --json` (a few seconds of listening), run on the Python the extension
 * carries for it, so it needs nothing installed. It runs only when someone asks for the desk to be read, the Hardware
 * page's refresh, or at start-up on a computer that has seen a gateway over Bluetooth before: a first scan makes
 * macOS ask whether the editor may use Bluetooth, and that question must follow from something the developer did.
 *
 * A unit advertises only inside its commissioning window. One seen earlier in this session and gone now is kept,
 * marked with its window closed, so the page can say "hold its button 3 s" instead of forgetting it.
 */

const TOOL_ID = "adsum/nrf/tools/blg20-service"
const SCAN_S = 4

const seen = new Map<string, Blg20BleRow>()
let lastError: string | undefined
let lastScanAt = 0
let running: Promise<Blg20BleRow[]> | null = null

/** The units from the last scan, plus the ones seen earlier in this session whose window has closed since. */
export function getCachedBleRows(): Blg20BleRow[] {
	return [...seen.values()]
}

/** Why the last scan found nothing, in words ("Bluetooth is off", the tool's own error), or undefined. */
export function lastBleScanError(): string | undefined {
	return lastError
}

export function lastBleScanTime(): number {
	return lastScanAt
}

function seenMarker(): string | undefined {
	try {
		const dir = HostProvider.get().globalStorageFsPath
		return dir ? path.join(dir, "ble-gateways-seen.json") : undefined
	} catch {
		return undefined
	}
}

/** True once a gateway has been seen over Bluetooth on this computer: start-up may scan from then on. */
export function bleGatewaySeenBefore(): boolean {
	const f = seenMarker()
	return !!f && existsSync(f)
}

function markSeen(n: number): void {
	const f = seenMarker()
	if (!f || n === 0) return
	try {
		mkdirSync(path.dirname(f), { recursive: true })
		writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), units: n }))
	} catch {
		// a marker is a convenience; never a reason to fail a scan
	}
}

/** Pure: fold one scan's answer into what is known. Exported for the tests. */
export function foldScan(known: Map<string, Blg20BleRow>, answer: unknown): { rows: Blg20BleRow[]; error?: string } {
	const a = answer as { ok?: boolean; units?: Blg20BleRow[]; error?: string } | null
	if (!a || a.ok !== true || !Array.isArray(a.units)) {
		return { rows: [...known.values()], error: a?.error ?? "the scan gave no answer" }
	}
	const now = new Set<string>()
	for (const u of a.units) {
		const key = (u.id ?? u.name ?? u.address).toUpperCase()
		now.add(key)
		known.set(key, { ...u, window: true })
	}
	for (const [key, u] of known) {
		if (!now.has(key)) known.set(key, { ...u, window: false, rssi: null })
	}
	return { rows: [...known.values()] }
}

/** Run one scan (a second caller shares the running one). Never throws: a failed scan keeps what was known. */
export function scanBleGateways(reason: "refresh" | "startup"): Promise<Blg20BleRow[]> {
	if (running) {
		return running
	}
	running = (async () => {
		try {
			const r = await resolveToolAsync(TOOL_ID)
			if (!("tool" in r) || !r.tool.argv?.length || r.tool.unavailable) {
				lastError = "unavailable" in r ? `the service tool is not available (${r.unavailable})` : r.tool?.unavailable
				return getCachedBleRows()
			}
			const argv = [...r.tool.argv, "list", "--ble", "--json", "--timeout", String(SCAN_S)]
			const out = await new Promise<string>((resolve) => {
				execFile(
					argv[0],
					argv.slice(1),
					{ timeout: (SCAN_S + 25) * 1000, maxBuffer: 1 << 20, windowsHide: true },
					(_err, stdout) => resolve(String(stdout ?? "")),
				)
			})
			let answer: unknown = null
			try {
				answer = JSON.parse(out.trim().split(/\r?\n/).pop() ?? "")
			} catch {
				answer = null
			}
			const { rows, error } = foldScan(seen, answer)
			lastError = error
			lastScanAt = Date.now()
			markSeen(rows.filter((u) => u.window).length)
			Logger.info(
				`bleGateways: ${reason} scan: ${rows.filter((u) => u.window).length} in range${error ? ` (${error})` : ""}`,
			)
			return rows
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e)
			Logger.warn(`bleGateways: ${reason} scan failed: ${lastError}`)
			return getCachedBleRows()
		} finally {
			running = null
		}
	})()
	return running
}

// ── the Hardware page's journey, before any session ──────────────────────────────────────────────────────────────
// [11 Oct 2026, operator] "detect the gateway from the extension, once detected connect and pair to it, then claim,
// then check firmware: if older than the latest, propose the upgrade." Each step is one run of the service tool by
// the host (never the agent), its facts kept here per unit and merged into the unit rows the page draws, its words
// kept per unit so the row can say what happened. The pairing is a side effect of the first connection: the tool's
// `status` opens the link (macOS and Windows ask in their dialog, Linux takes --passkey), reads the passport and
// whose key owns the unit, and changes nothing. `claim` is the one write, and the page asks before it.

/** What the journey knows about one unit, by its twelve hex digits. */
export interface BleFacts {
	paired?: boolean
	claimed?: boolean
	mine?: boolean
	bleFw?: string
	lteFw?: string
	latest?: Blg20Unit["latest"]
	words?: string
	commission?: Blg20Commission
}

/**
 * Pure: the commissioning facts from the tool's answer (`status` carries them as `commission`, `prov status` is them),
 * or undefined when the answer has none (a tool or a firmware without the commissioner's characteristics).
 * Exported for the tests.
 */
export function commissionFrom(answer: unknown): Blg20Commission | undefined {
	const a = answer as Record<string, unknown> | null
	if (!a || typeof a.commissioned !== "boolean" || typeof a.line !== "string") return undefined
	const v = ((a.health as Record<string, unknown> | undefined)?.verdict ?? undefined) as
		| { state?: unknown; words?: unknown }
		| undefined
	const state = v?.state === "go" || v?.state === "warn" || v?.state === "stop" ? v.state : undefined
	return {
		commissioned: a.commissioned,
		line: a.line,
		...(state ? { verdict: { state, words: typeof v?.words === "string" ? v.words : "" } } : {}),
		...(typeof a.window === "string" || a.window === null ? { window: a.window as string | null } : {}),
	}
}

const facts = new Map<string, BleFacts>()
let preferredId: string | null = null

export function getBleFacts(id: string): BleFacts | undefined {
	return facts.get(id.toUpperCase())
}

/** The unit the developer picked on the page: it leads the unit list, so Flash, Set it up and the actions follow it. */
export function preferredBleGateway(): string | null {
	return preferredId
}

export function selectBleGateway(id: string): void {
	preferredId = id.toUpperCase()
}

function remember(id: string, more: BleFacts): BleFacts {
	const key = id.toUpperCase()
	const next = { ...(facts.get(key) ?? {}), ...more }
	facts.set(key, next)
	return next
}

/** The unit's twelve digits from any name the page may pass (four digits, twelve, an address, the advertised name). */
function idOf(target: string): string | undefined {
	const t = target.trim().toUpperCase()
	const hex = t.replace(/[:\-\s]/g, "")
	const rows = getCachedBleRows()
	const hit = rows.find((r) => {
		const id = (r.id ?? "").toUpperCase()
		return (
			id === hex ||
			id.endsWith(hex) ||
			r.address.toUpperCase().replace(/[:-]/g, "") === hex ||
			(r.name ?? "").toUpperCase().replace(/\s/g, "") === hex
		)
	})
	return hit?.id?.toUpperCase() ?? (/^[0-9A-F]{12}$/.test(hex) ? hex : undefined)
}

interface ToolRun {
	rc: number | null
	/** The tool's last stdout line as JSON, when it is one. */
	last: Record<string, unknown> | null
	stderr: string
}

/** One run of the service tool on the extension's Python, the last JSON line parsed. Never throws. */
async function runTool(args: string[], timeoutS: number): Promise<ToolRun> {
	const r = await resolveToolAsync(TOOL_ID)
	if (!("tool" in r) || !r.tool.argv?.length || r.tool.unavailable) {
		const why = "unavailable" in r ? `the service tool is not available (${r.unavailable})` : (r.tool?.unavailable ?? "")
		return { rc: null, last: { ok: false, error: why }, stderr: why }
	}
	const argv = [...r.tool.argv, ...args]
	return new Promise<ToolRun>((resolve) => {
		execFile(
			argv[0],
			argv.slice(1),
			{ timeout: timeoutS * 1000, maxBuffer: 1 << 20, windowsHide: true },
			(err, stdout, stderr) => {
				const lines = String(stdout ?? "")
					.trim()
					.split(/\r?\n/)
					.filter(Boolean)
				let last: Record<string, unknown> | null = null
				try {
					last = JSON.parse(lines[lines.length - 1] ?? "") as Record<string, unknown>
				} catch {
					last = null
				}
				const code =
					err && typeof (err as { code?: unknown }).code === "number"
						? ((err as { code: number }).code ?? null)
						: err
							? null
							: 0
				if (err && (err as { killed?: boolean }).killed) {
					resolve({
						rc: null,
						last: { ok: false, error: `the tool did not answer within ${timeoutS} s` },
						stderr: String(stderr ?? ""),
					})
					return
				}
				resolve({ rc: code, last, stderr: String(stderr ?? "") })
			},
		)
	})
}

/** The tool's own sentence for a failed run: its JSON error, else the last line it printed. */
function wordsOf(run: ToolRun): string {
	const e = run.last && typeof run.last.error === "string" ? run.last.error : ""
	if (e) return e
	const lines = run.stderr.trim().split(/\r?\n/).filter(Boolean)
	return lines[lines.length - 1] ?? "the tool gave no answer"
}

/** A unit held by a running session cannot be touched from the page: the session's own command is on it. */
function heldWords(id: string): string | undefined {
	const h = holderOf(`BLE:${id.slice(-4)}`) ?? holderOf("BLE:ANY")
	return h ? `in use by the session "${h.title}": wait for it, or close it` : undefined
}

export interface BleStepResult {
	ok: boolean
	words: string
	facts?: BleFacts
}

/** Connect (pairing the first time), read the passport and the owner: the page's first step, read-only. */
export async function bleStatus(target: string, passkey?: string): Promise<BleStepResult> {
	const id = idOf(target)
	if (!id) return { ok: false, words: `no gateway named ${target} was seen in the last scan` }
	const held = heldWords(id)
	if (held) return { ok: false, words: held }
	const run = await runTool(["status", "--ble", id, "--json", "--passkey", passkey || "auto"], 160)
	if (!run.last || run.last.ok !== true) {
		const words = wordsOf(run)
		return { ok: false, words, facts: remember(id, { words }) }
	}
	const p = (run.last.passport ?? {}) as Record<string, unknown>
	markBonded(id, true)
	const f = remember(id, {
		paired: true,
		claimed: run.last.claimed === true,
		mine: run.last.mine === true,
		bleFw: typeof p.ble_fw === "string" ? p.ble_fw : undefined,
		lteFw: typeof p.lte_fw === "string" ? p.lte_fw : undefined,
		words: undefined,
		// The same link read the commissioner's characteristics too (tool 0.4.0): the fourth step needs no second run.
		commission: commissionFrom(run.last.commission),
	})
	const owner = f.claimed ? (f.mine ? "claimed by this computer" : "claimed by another computer's key") : "not claimed yet"
	return { ok: true, words: `paired · Bluetooth half ${f.bleFw ?? "?"}, cellular half ${f.lteFw ?? "?"} · ${owner}`, facts: f }
}

/** Read what the unit holds as commissioned again (after a session changed it): one run of `prov status`, read-only. */
export async function bleCommission(target: string, passkey?: string): Promise<BleStepResult> {
	const id = idOf(target)
	if (!id) return { ok: false, words: `no gateway named ${target} was seen in the last scan` }
	const held = heldWords(id)
	if (held) return { ok: false, words: held }
	const run = await runTool(["prov", "status", "--ble", id, "--json", "--passkey", passkey || "auto"], 160)
	const c = run.last && run.last.ok === true ? commissionFrom(run.last) : undefined
	if (!c) {
		const words = wordsOf(run)
		return { ok: false, words, facts: remember(id, { words }) }
	}
	markBonded(id, true)
	const f = remember(id, { paired: true, commission: c, words: undefined })
	return { ok: true, words: c.verdict ? `${c.line} · ${c.verdict.words}` : c.line, facts: f }
}

/** The one write: this computer's key becomes the unit's owner key (the tool creates the key when there is none). */
export async function bleClaim(target: string, passkey?: string): Promise<BleStepResult> {
	const id = idOf(target)
	if (!id) return { ok: false, words: `no gateway named ${target} was seen in the last scan` }
	const held = heldWords(id)
	if (held) return { ok: false, words: held }
	const run = await runTool(["claim", "--ble", id, "--json", "--passkey", passkey || "auto"], 160)
	if (!run.last) {
		const words = wordsOf(run)
		return { ok: false, words, facts: remember(id, { words }) }
	}
	const why = typeof run.last.why === "string" ? run.last.why : ""
	if (run.last.ok === true) {
		markBonded(id, true)
		const f = remember(id, { paired: true, claimed: true, mine: true, words: undefined })
		const key = typeof run.last.key === "string" ? run.last.key : ""
		return {
			ok: true,
			words:
				why === "already yours"
					? "claimed by this computer already"
					: `claimed: this computer's key owns it now${key ? ` (the key is at ${key}: back it up)` : ""}`,
			facts: f,
		}
	}
	const words =
		why === "already claimed by another key"
			? "claimed by another computer's key: that computer releases it (owner-clear), or the unit's ten-second button wipe does"
			: wordsOf(run)
	return {
		ok: false,
		words,
		facts: remember(id, { claimed: why.startsWith("already") ? true : undefined, mine: false, words }),
	}
}

/**
 * The last scan's word on the pairing, corrected by what a step just proved: a session started from the page after
 * Connect was still told "this computer has no pairing with the unit yet" until the next scan (11 Oct 2026, the bench).
 */
function markBonded(id: string, bonded: boolean): void {
	const key = id.toUpperCase()
	const row = seen.get(key) ?? [...seen.values()].find((r) => (r.id ?? "").toUpperCase() === key)
	if (row) seen.set((row.id ?? row.name ?? row.address).toUpperCase(), { ...row, bonded })
}

/** Drop this computer's pairing with the unit (Linux and Windows through the tool; macOS says where). */
export async function bleForget(target: string): Promise<BleStepResult> {
	const id = idOf(target)
	if (!id) return { ok: false, words: `no gateway named ${target} was seen in the last scan` }
	const held = heldWords(id)
	if (held) return { ok: false, words: held }
	const run = await runTool(["forget", "--ble", id, "--json"], 60)
	if (!run.last || run.last.ok !== true) {
		const words = wordsOf(run)
		return { ok: false, words, facts: remember(id, { words }) }
	}
	markBonded(id, false)
	return {
		ok: true,
		words: "pairing forgotten: the next connection pairs again",
		facts: remember(id, { paired: false, words: undefined }),
	}
}

/** Compare the halves' versions with the latest release the account can see for the family. */
function vOlder(have: string | undefined, latest: string | null | undefined): boolean {
	if (!have || !latest) return false
	const a = have.split(".").map((n) => Number.parseInt(n, 10) || 0)
	const b = latest.split(".").map((n) => Number.parseInt(n, 10) || 0)
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (b[i] ?? 0) - (a[i] ?? 0)
		if (d !== 0) return d > 0
	}
	return false
}

function newest(entries: FirmwareEntry[]): FirmwareEntry | undefined {
	return [...entries].sort((x, y) => (vOlder(x.version, y.version) ? 1 : vOlder(y.version, x.version) ? -1 : 0))[0]
}

/**
 * The firmware step: the latest release for the unit's family, its halves' versions from its release record (the
 * downloaded folder's usb/release.json, else the record fetched by itself, 14 lines, under the account's own
 * authorisation), and whether it is newer than what the unit runs. The page proposes the upgrade; the Flash row flashes.
 */
export async function bleCheckFirmware(target: string, family: string, wsRoot?: string): Promise<BleStepResult> {
	const id = idOf(target)
	if (!id) return { ok: false, words: `no gateway named ${target} was seen in the last scan` }
	const f = facts.get(id)
	if (!f?.bleFw) return { ok: false, words: "connect first: the unit's versions come from its passport" }
	const client = new FirmwareClient()
	const m = await client.manifest().catch(() => ({ firmware: [] as FirmwareEntry[], account: null }))
	const mine = m.firmware.filter((e) => e.family === family)
	const entry = newest(mine)
	if (!entry) {
		const words = `no release is listed for the ${family.toUpperCase()} in this account`
		return { ok: false, words, facts: remember(id, { words }) }
	}
	const account = getAccount()
	const entitled = entry.entitled || (!!account && hasGroup(entry.group ?? undefined))
	let release: { ble?: string; lte?: string } | null = null
	const folder = wsRoot ? defaultFolder(wsRoot, entry) : undefined
	if (folder && existsSync(path.join(folder, "usb", "release.json"))) {
		try {
			release = JSON.parse(readFileSync(path.join(folder, "usb", "release.json"), "utf8")).release ?? null
		} catch {
			release = null
		}
	}
	if (!release && entitled) {
		const member = entry.artifacts.find((a) => a.path === "usb/release.json")
		if (member) {
			try {
				const auth = await client.authorise(entry.id, entry.version)
				const buf = await client.artifact(member.sha256, auth.token, member.path)
				release = JSON.parse(buf.toString("utf8")).release ?? null
			} catch {
				release = null
			}
		}
	}
	const newer = release ? vOlder(f.bleFw, release.ble) || vOlder(f.lteFw, release.lte) : false
	// A bench build ahead of the latest release is said as such, never as "up to date".
	const ahead = release && !newer ? vOlder(release.ble, f.bleFw) || vOlder(release.lte, f.lteFw) : false
	const latest: Blg20Unit["latest"] = {
		version: entry.version,
		bleFw: release?.ble ?? null,
		lteFw: release?.lte ?? null,
		newer,
		...(ahead ? { ahead: true } : {}),
		folder,
	}
	const facts2 = remember(id, { latest, words: undefined })
	const have = `Bluetooth half ${f.bleFw}, cellular half ${f.lteFw ?? "?"}`
	const words = !release
		? `latest listed: v${entry.version}${entitled ? " (its versions could not be read)" : " (not in this account's rungs)"}; the unit runs ${have}`
		: newer
			? `newer available: v${entry.version} (Bluetooth half ${release.ble}, cellular half ${release.lte}); the unit runs ${have}. Flash v${entry.version} over Bluetooth below`
			: ahead
				? `the unit runs a newer build than the latest release v${entry.version} (Bluetooth half ${release.ble}, cellular half ${release.lte}): ${have}`
				: `up to date: v${entry.version} is ${have}`
	return { ok: true, words, facts: facts2 }
}
