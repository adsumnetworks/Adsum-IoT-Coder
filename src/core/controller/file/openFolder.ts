import { Empty, StringRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { Controller } from ".."

export const ADSUM_REVEAL_SIDEBAR_KEY = "adsumRevealSidebarPath"

/**
 * Opens a folder in VS Code.
 * Empty value → shows the native folder picker first, then opens the chosen folder.
 * Non-empty value → opens that path directly.
 * Stores a reveal flag so that on next activation Adsum auto-reveals (window reloads on folder open).
 */
export async function openFolder(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		let folderPath = request.value

		if (!folderPath) {
			const result = await HostProvider.window.showOpenDialogue({
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: "Select Folder",
			})
			folderPath = result.paths[0]
		}

		if (folderPath) {
			await _controller.context.globalState.update(ADSUM_REVEAL_SIDEBAR_KEY, folderPath)
			await HostProvider.workspace.openFolder({ path: folderPath, newWindow: false })
		}
	} catch (error) {
		console.error("[openFolder] Failed to open folder:", error)
	}

	return Empty.create()
}
