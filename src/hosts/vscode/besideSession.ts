import * as vscode from "vscode"
import { columnBesideSession } from "./besideSessionColumn"

/**
 * The column a file or a change view opens in so that it does not cover the session tab the developer is looking
 * at; undefined when the active tab is not a session. See `columnBesideSession`.
 */
export function viewColumnBesideSession(): vscode.ViewColumn | undefined {
	try {
		const where = columnBesideSession(
			vscode.window.tabGroups.all.map((g) => ({
				active: g.isActive,
				viewColumn: g.viewColumn,
				frontWebviewType: g.activeTab?.input instanceof vscode.TabInputWebview ? g.activeTab.input.viewType : undefined,
			})),
		)
		return where === "beside" ? vscode.ViewColumn.Beside : where
	} catch {
		return undefined
	}
}
