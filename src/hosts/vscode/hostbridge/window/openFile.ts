import * as vscode from "vscode"
import { viewColumnBesideSession } from "@/hosts/vscode/besideSession"
import { OpenFileRequest, OpenFileResponse } from "@/shared/proto/host/window"

export async function openFile(request: OpenFileRequest): Promise<OpenFileResponse> {
	// [0.5 sessions first] Not over the session tab the developer is reading.
	const viewColumn = viewColumnBesideSession()
	await vscode.commands.executeCommand(
		"vscode.open",
		vscode.Uri.file(request.filePath),
		...(viewColumn !== undefined ? [{ viewColumn }] : []),
	)
	return OpenFileResponse.create({})
}
