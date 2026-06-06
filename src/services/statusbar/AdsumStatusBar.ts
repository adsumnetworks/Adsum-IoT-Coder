import type * as vscode from "vscode"

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

let _item: vscode.StatusBarItem | undefined

/** Creates and shows the status-bar item, pushing disposal onto context.subscriptions. */
export function createAdsumStatusBar(context: vscode.ExtensionContext, vscodeApi: typeof vscode): vscode.StatusBarItem {
	const item = vscodeApi.window.createStatusBarItem(vscodeApi.StatusBarAlignment.Right, 100)
	item.command = FOCUS_COMMAND
	item.tooltip = "Open Adsum IoT Coder"
	_item = item
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

/** Resets the singleton (used in tests to avoid cross-test leakage). */
export function resetAdsumStatusBarForTest(): void {
	_item = undefined
}
