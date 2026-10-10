import { type Blg20Unit, blg20BleWords } from "@shared/blg20"
import type * as vscode from "vscode"
import type { EspEnvironment } from "@/services/esp/EspEnvironmentDetector"
import type { NrfEnvironment } from "@/services/nrf/EnvironmentDetector"
import type { OpenSessionSummary } from "@/shared/ExtensionMessage"

const FOCUS_COMMAND = "adsum-iot-coder.SidebarProvider.focus"
const ICON = "$(adsum-iot-coder-icon)"

/** Compact token label: ≥1M → one decimal (e.g. 1.3M), ≥1K → rounded K, else raw. */
function formatTokens(n: number): string {
	if (n >= 1_000_000) {
		return `${Math.round(n / 100_000) / 10}M`
	}
	if (n >= 1000) {
		return `${Math.round(n / 1000)}K`
	}
	return `${n}`
}

/** A held port as the tooltip names it. */
export interface HeldPort {
	port: string
	title: string
}

/**
 * [0.5 sessions first] The one word after the mark. A session waiting on an answer comes first (it is the
 * thing to look at), then a session in error, then the unit on the desk. Never two things: the status bar is
 * one line wide and the ESP-IDF extension already crowds it.
 */
export function pickHeadline(sessions: readonly OpenSessionSummary[] = [], unit?: string): string | undefined {
	const waiting = sessions.find((s) => s.waiting)
	if (waiting) {
		return `${(waiting.title || "a session").split(" · ")[0].slice(0, 24)} waiting`
	}
	return unit
}

/** Formats the status-bar label. Pure — no VS Code imports, exportable for unit tests. */
export function formatStatusText(tokens?: number, headline?: string): string {
	let text = `${ICON} Adsum`
	if (headline) {
		text += ` · ${headline}`
	}
	if (tokens !== undefined) {
		text += ` · $(zap) ${formatTokens(tokens)}`
	}
	return text
}

/** Ensures a single leading "v" on a version string. */
function withV(v: string): string {
	return v.startsWith("v") ? v : `v${v}`
}

/** The unit or board the label names, by its own name, when there is exactly one obvious one. */
export function unitLabel(env?: NrfEnvironment, esp?: EspEnvironment): string | undefined {
	const blg = ((env as { blg20Units?: Blg20Unit[] } | undefined)?.blg20Units ?? []).filter((u) => u.confirmed !== false)
	if (blg.length) {
		const u = blg[0]
		const word = u.family === "lbg20x" ? "LBG20x" : "BLG20x"
		return u.name ? `${word} ${u.name}` : word
	}
	const board = env?.boards?.[0]
	if (board) {
		return (board.productName || board.deviceName || board.deviceFamily || "").toString() || undefined
	}
	const dev = esp?.espDevices?.[0]
	if (dev) {
		return dev.chip || "ESP32"
	}
	return undefined
}

/** Builds a multi-line tooltip: both platforms, the units with their holders, the open sessions. */
export function buildStatusBarTooltip(
	env?: NrfEnvironment,
	esp?: EspEnvironment,
	sessions: readonly OpenSessionSummary[] = [],
	held: readonly HeldPort[] = [],
): string {
	const lines: string[] = ["Open Adsum IoT Coder", ""]
	if (env && env.status !== "unknown") {
		const extLine = env.extensionPresent ? `nRF Connect ext v${env.extensionVersion ?? "?"}` : "nRF Connect not detected"
		lines.push(`$(server-environment) ${extLine}`)
		if (env.projectSdk) {
			const where = env.projectSdk.source === "build" ? "this build" : "workspace"
			lines.push(`$(package) NCS ${withV(env.projectSdk.version)} · ${where}`)
		} else {
			const sdkVersions = env.installedSdkVersions ?? []
			if (sdkVersions.length > 0) {
				lines.push(`$(package) NCS ${sdkVersions.map(withV).join(", ")} installed`)
			}
		}
		if (env.status === "detecting") {
			lines.push("$(plug) detecting boards…")
		} else if (!env.nrfutilPresent) {
			lines.push("$(plug) nrfutil not found")
		} else if (env.boards.length === 0) {
			lines.push("$(plug) no boards connected")
		} else {
			const names = env.boards
				.map((b) => {
					const name = b.deviceName ?? b.deviceFamily ?? b.serialNumber
					return b.boardVersion && b.deviceName ? `${name} (${b.boardVersion})` : name
				})
				.join(", ")
			lines.push(`$(plug) ${env.boards.length} board${env.boards.length > 1 ? "s" : ""}: ${names}`)
		}
		const blg = (env as { blg20Units?: Blg20Unit[] }).blg20Units ?? []
		for (const u of blg) {
			// The door, in words: the USB port, or over Bluetooth with the window and the pairing (the LBG20x).
			const door = u.servicePort ? ` · ${u.servicePort}` : u.bleAddress ? ` · ${blg20BleWords(u)}` : ""
			lines.push(`$(circuit-board) ${u.family === "lbg20x" ? "LBG20x" : "BLG20x"} ${u.name ?? ""}${door}`.trim())
		}
	}
	if (esp && esp.status !== "unknown") {
		lines.push(`$(server-environment) ${esp.extensionPresent || esp.idfPresent ? "ESP-IDF present" : "ESP-IDF not detected"}`)
		const devs = esp.espDevices ?? []
		if (devs.length) {
			lines.push(`$(plug) ${devs.map((d) => d.chip || "ESP32").join(", ")}`)
		}
	}
	for (const h of held) {
		lines.push(`$(lock) ${h.port} held by ${h.title}`)
	}
	if (sessions.length) {
		lines.push("")
		for (const s of sessions) {
			lines.push(
				`$(comment-discussion) ${s.title || "New session"}${s.waiting ? " · waiting on you" : s.streaming ? " · working" : ""}`,
			)
		}
	}
	return lines.join("\n")
}

let _item: vscode.StatusBarItem | undefined
let _vscodeApi: typeof vscode | undefined
let _tokens: number | undefined
let _headline: string | undefined
let _sessions: () => OpenSessionSummary[] = () => []
let _held: () => HeldPort[] = () => []
let _nrf: NrfEnvironment | undefined
let _esp: EspEnvironment | undefined

/** Creates and shows the status-bar item, pushing disposal onto context.subscriptions. */
export function createAdsumStatusBar(context: vscode.ExtensionContext, vscodeApi: typeof vscode): vscode.StatusBarItem {
	// High priority so the Adsum item stays visible (shown further left + survives status-bar
	// collapsing) when the ESP-IDF extension floods the right side with target/port/build/flash icons.
	const item = vscodeApi.window.createStatusBarItem(vscodeApi.StatusBarAlignment.Right, 10_000)
	item.command = FOCUS_COMMAND
	item.tooltip = "Open Adsum IoT Coder"
	_item = item
	_vscodeApi = vscodeApi
	context.subscriptions.push(item)
	return item
}

/** The host tells the bar where to read the open sessions and the held ports from. */
export function bindStatusBarSources(sessions: () => OpenSessionSummary[], held: () => HeldPort[]): void {
	_sessions = sessions
	_held = held
}

function repaint(): void {
	if (!_item) {
		return
	}
	let sessions: OpenSessionSummary[] = []
	let held: HeldPort[] = []
	try {
		sessions = _sessions()
		held = _held()
	} catch {
		// the sources must never break the bar
	}
	_headline = pickHeadline(sessions, unitLabel(_nrf, _esp))
	_item.text = formatStatusText(_tokens, _headline)
	if (_vscodeApi) {
		const md = new _vscodeApi.MarkdownString(buildStatusBarTooltip(_nrf, _esp, sessions, held), true)
		md.isTrusted = true
		_item.tooltip = md
	}
	_item.show()
}

/** Refreshes the status-bar text and ensures it is visible. */
export function refreshAdsumStatusBar(tokens?: number): void {
	_tokens = tokens
	repaint()
}

/** Enriches the status-bar tooltip with the platform facts (non-breaking if either is absent). */
export function setAdsumStatusBarTooltip(env: NrfEnvironment, esp?: EspEnvironment): void {
	_nrf = env
	if (esp) {
		_esp = esp
	}
	repaint()
}

/** Resets the singleton (used in tests to avoid cross-test leakage). */
export function resetAdsumStatusBarForTest(): void {
	_item = undefined
	_vscodeApi = undefined
	_tokens = undefined
	_headline = undefined
	_nrf = undefined
	_esp = undefined
	_sessions = () => []
	_held = () => []
}
