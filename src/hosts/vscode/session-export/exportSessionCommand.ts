/** "Adsum: Export this session…" — hand one session to someone else as a single file.
 *
 *  Sharing a session today means finding a globalStorage directory whose location differs per OS and per
 *  editor flavour, then copying raw transcripts around. Nobody should have to know that path, and nobody
 *  should be shipping unredacted transcripts by hand — see SessionExport.ts for why redaction happens at
 *  write time rather than wherever the file ends up.
 */
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { exportSessionFolder, SESSION_EXPORT_EXT } from "@/services/session-export/SessionExport"

/** Sessions newest-first, with a readable label taken from the opening message. */
function listSessions(tasksDir: string): { id: string; label: string; when: Date }[] {
	if (!fs.existsSync(tasksDir)) {
		return []
	}
	return fs
		.readdirSync(tasksDir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && fs.existsSync(path.join(tasksDir, e.name, "ui_messages.json")))
		.map((e) => {
			const dir = path.join(tasksDir, e.name)
			let label = ""
			try {
				const ui = JSON.parse(fs.readFileSync(path.join(dir, "ui_messages.json"), "utf8"))
				label = String(ui.find((m: any) => m?.say === "text" && m?.text)?.text ?? "")
					.replace(/\s+/g, " ")
					.slice(0, 90)
			} catch {}
			return { id: e.name, label: label || "(no opening message)", when: fs.statSync(dir).mtime }
		})
		.sort((a, b) => b.when.getTime() - a.when.getTime())
}

export async function exportSessionCommand(context: vscode.ExtensionContext): Promise<void> {
	const tasksDir = path.join(context.globalStorageUri.fsPath, "tasks")
	const sessions = listSessions(tasksDir)
	if (!sessions.length) {
		vscode.window.showInformationMessage("No sessions to export yet — run a task first.")
		return
	}

	const pick = await vscode.window.showQuickPick(
		sessions.slice(0, 50).map((s) => ({
			label: s.label,
			description: s.when.toLocaleString(),
			detail: `session ${s.id}`,
			id: s.id,
		})),
		{ title: "Export this session", placeHolder: "Which session do you want to share?" },
	)
	if (!pick) {
		return
	}

	const target = await vscode.window.showSaveDialog({
		title: "Export session",
		defaultUri: vscode.Uri.file(path.join(require("os").homedir(), `${pick.id}${SESSION_EXPORT_EXT}`)),
		filters: { "Adsum session": ["gz"] },
		saveLabel: "Export",
	})
	if (!target) {
		return
	}

	try {
		const r = exportSessionFolder({
			taskDir: path.join(tasksDir, pick.id),
			outPath: target.fsPath,
			taskId: pick.id,
			extensionVersion: context.extension?.packageJSON?.version ?? null,
		})
		// State the redaction count either way. "0 removed" is information, not silence — and the caveat is
		// honest: pattern-based redaction is a safety net, not a proof.
		const summary = r.redactions
			? `${r.redactions} secret-shaped value${r.redactions === 1 ? "" : "s"} removed (${Object.keys(r.byKind).join(", ")}).`
			: "No secrets detected."
		const choice = await vscode.window.showInformationMessage(
			`Session exported. ${summary} Review the file before sharing widely.`,
			"Show in folder",
		)
		if (choice === "Show in folder") {
			await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(r.file))
		}
	} catch (e: any) {
		vscode.window.showErrorMessage(`Could not export that session: ${String(e?.message || e)}`)
	}
}
