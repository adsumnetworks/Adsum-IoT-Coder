import { Empty, StringRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { Controller } from ".."

/**
 * Opens a folder in VS Code.
 * Empty value → shows the native folder picker first, then opens the chosen folder.
 * Non-empty value → opens that path directly.
 */
export async function openFolder(_controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		let folderPath = request.value

		if (!folderPath) {
			const result = await HostProvider.window.showOpenDialogue({
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: "Open nRF Project",
			})
			folderPath = result.paths[0]
		}

		if (folderPath) {
			await HostProvider.workspace.openFolder({ path: folderPath, newWindow: false })
		}
	} catch (error) {
		console.error("[openFolder] Failed to open folder:", error)
	}

	return Empty.create()
}
