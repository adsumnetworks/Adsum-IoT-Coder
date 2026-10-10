import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"

export type AutoApproveActionKey = keyof AutoApprovalSettings["actions"]

/** The ask types an inline approval row answers — a permission, never a question. */
export const APPROVAL_ASK_TYPES = new Set<ClineMessage["ask"]>(["tool", "command", "browser_action_launch", "use_mcp_server"])

const EDIT_TOOLS = new Set(["editedExistingFile", "newFileCreated", "fileDeleted"])
const READ_TOOLS = new Set(["readFile", "listFilesTopLevel", "listFilesRecursive", "listCodeDefinitionNames", "searchFiles"])
const EXECUTE_TOOLS = new Set(["triggerNordicAction", "triggerEspAction", "triggerCveScan"])

function parseToolSafe(text: string | undefined): ClineSayTool | null {
	try {
		return JSON.parse(text || "{}") as ClineSayTool
	} catch {
		return null
	}
}

/**
 * Which `AutoApprovalSettings.actions` key "Allow for this session" sets for a given ask — the mapping
 * behind the middle control on an inline approval row. Returns `undefined` for an ask with no matching
 * permission (an unmapped tool kind, or an ask outside `APPROVAL_ASK_TYPES`); the row still approves this
 * one instance, it just has no broader permission to grant.
 */
export function autoApproveActionFor(message: ClineMessage): AutoApproveActionKey | undefined {
	switch (message.ask) {
		case "command":
			// It reached the developer at all, so the existing "safe commands" class did not already
			// cover it — the broader permission is the one that stops asking again this session.
			return "executeAllCommands"
		case "browser_action_launch":
			return "useBrowser"
		case "use_mcp_server":
			return "useMcp"
		case "tool": {
			const tool = parseToolSafe(message.text)?.tool
			if (!tool) {
				return undefined
			}
			if (EDIT_TOOLS.has(tool)) {
				return "editFiles"
			}
			if (READ_TOOLS.has(tool)) {
				return "readFiles"
			}
			if (EXECUTE_TOOLS.has(tool)) {
				return "executeAllCommands"
			}
			return undefined
		}
		default:
			return undefined
	}
}
