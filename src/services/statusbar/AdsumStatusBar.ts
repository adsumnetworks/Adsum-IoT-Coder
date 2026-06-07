import type * as vscode from "vscode"
import type { NrfEnvironment } from "@/services/nrf/EnvironmentDetector"

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

/** Formats the status-bar label. Pure — no VS Code imports, exportable for unit tests. */
export function formatStatusText(tokens?: number): string {
	if (tokens === undefined) {
		return `${ICON} Adsum Coder`
	}
	return `${ICON} Adsum Coder · $(zap) ${formatTokens(tokens)}`
}

/** Ensures a single leading "v" on a version string. */
function withV(v: string): string {
	return v.startsWith("v") ? v : `v${v}`
}

/** Builds a multi-line tooltip that includes nRF Connect + board facts when available. */
export function buildStatusBarTooltip(env?: NrfEnvironment): string {
	if (!env || env.status === "unknown") {
		return "Open Adsum IoT Coder"
	}

	const lines: string[] = ["Open Adsum IoT Coder", ""]

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

	return lines.join("\n")
}

let _item: vscode.StatusBarItem | undefined
let _vscodeApi: typeof vscode | undefined

/** Creates and shows the status-bar item, pushing disposal onto context.subscriptions. */
export function createAdsumStatusBar(context: vscode.ExtensionContext, vscodeApi: typeof vscode): vscode.StatusBarItem {
	const item = vscodeApi.window.createStatusBarItem(vscodeApi.StatusBarAlignment.Right, 100)
	item.command = FOCUS_COMMAND
	item.tooltip = "Open Adsum IoT Coder"
	_item = item
	_vscodeApi = vscodeApi
	context.subscriptions.push(item)
	return item
}

/** Refreshes the status-bar text and ensures it is visible. */
export function refreshAdsumStatusBar(tokens?: number): void {
	if (!_item) {
		return
	}
	_item.text = formatStatusText(tokens)
	_item.show()
}

/** Enriches the status-bar tooltip with nRF environment facts (non-breaking if env absent). */
export function setAdsumStatusBarTooltip(env: NrfEnvironment): void {
	if (!_item || !_vscodeApi) {
		return
	}
	const md = new _vscodeApi.MarkdownString(buildStatusBarTooltip(env), true)
	md.isTrusted = true
	_item.tooltip = md
}

/** Resets the singleton (used in tests to avoid cross-test leakage). */
export function resetAdsumStatusBarForTest(): void {
	_item = undefined
	_vscodeApi = undefined
}
