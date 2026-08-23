/** "Adsum: Headless engine info" — tell a caller where this installation's engine is, and what it is.
 *
 *  The Knowledge Studio and any external agent driving this extension headlessly need the path to
 *  `cline-core.js` and, just as importantly, a stamp they can record on whatever they produce with it.
 *  Guessing the path from an extension directory works until a layout changes; asking the extension does
 *  not. Read-only, no prompt: it discloses a path and a build stamp, never a setting or a key.
 */
import * as vscode from "vscode"
import { type HeadlessEngineInfo, headlessEngineAt, headlessEngineRef } from "@/services/headless/HeadlessEngine"

export interface HeadlessEngineInfoResult extends HeadlessEngineInfo {
	/** `shipped <sha8> v<version>` — what a run row should record. Null when this install has no engine. */
	ref: string | null
	extensionVersion: string | null
	extensionPath: string
}

export function headlessEngineInfoCommand(context: vscode.ExtensionContext): HeadlessEngineInfoResult {
	const info = headlessEngineAt(context.extensionPath)
	return {
		...info,
		ref: headlessEngineRef(info),
		extensionVersion: context.extension?.packageJSON?.version ?? null,
		extensionPath: context.extensionPath,
	}
}
