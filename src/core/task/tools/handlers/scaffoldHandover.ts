/**
 * Offer to OPEN a project the agent just scaffolded outside the open workspace.
 *
 * THE PROBLEM THIS SOLVES (reported 2026-08-15/16). The prototype flow starts with no folder open, so
 * the agent scaffolds into e.g. `Desktop\ble_relay\` while the workspace is still the Desktop. The code
 * lands correctly — but until the developer opens that folder:
 *
 *   - project memory is refused (the workspace is a personal folder, the new project is not the cwd),
 *   - checkpoints cannot initialise,
 *   - and the next session opens with none of it, so a "fresh" debug run re-probes every port and board
 *     it had already identified.
 *
 * The workflow already asks the developer to open the folder. Asking is where it stopped: a sentence in
 * the chat competes with whatever the developer is doing, and the one action that makes the difference
 * needs a file dialog and a window reload. So it was skipped, and the session paid for it.
 *
 * Opening a folder RELOADS the window and ends the running task, which is why this asks first and says
 * plainly where the conversation goes. The task is already persisted — it reopens from history.
 */
import * as path from "node:path"
import { ShowMessageType } from "@shared/proto/host/window"
import { hasProjectMarker, isForbiddenMemoryRoot } from "@/core/memory/workspace/projectAnchor"
import { HostProvider } from "@/hosts/host-provider"

/** Files whose creation means "a project now lives in this directory". */
const SCAFFOLD_MARKERS = new Set(["prj.conf", "CMakeLists.txt", "sdkconfig", "sdkconfig.defaults", "west.yml"])

/** Directories already offered this session — the offer must never become a second interruption. */
const offered = new Set<string>()

/** Normalised key so `C:\X` and `c:/x/` are one directory. */
function key(dir: string): string {
	return path
		.resolve(dir)
		.replace(/[\\/]+$/, "")
		.toLowerCase()
}

/**
 * True when writing `filePath` means a project was just scaffolded somewhere that leaves memory and
 * checkpoints broken, returning the directory to offer.
 *
 * The test is NOT "outside the workspace", which is the obvious rule and the wrong one. The reported
 * case is a project at `Desktop\ble_relay` with the Desktop open: that is *inside* the workspace, so an
 * outside-only rule never fires on the very scenario it was written for. What actually matters is
 * whether the developer has a REAL project open — memory anchors to the workspace, and the Desktop can
 * never hold it.
 *
 * So: offer when the scaffolded project is not the open folder itself, and the open folder is not
 * somewhere memory can live. A monorepo (workspace `gw/`, project `gw/ble-scanner/`) is excluded by the
 * second condition — `gw/` is a real project, so memory already works per-app and nothing is broken.
 */
export function isScaffoldOutsideWorkspace(filePath: string, cwd: string | undefined): string | null {
	if (!SCAFFOLD_MARKERS.has(path.basename(filePath))) {
		return null
	}
	const projectDir = path.dirname(path.resolve(filePath))

	// Already the open folder → memory and checkpoints work; there is nothing to hand over.
	if (cwd && key(cwd) === key(projectDir)) {
		return null
	}
	// The open folder is itself a project → memory anchors there (and per-app below it). Not broken.
	if (cwd && !isForbiddenMemoryRoot(cwd) && hasProjectMarker(cwd)) {
		return null
	}
	// The destination must itself be a project, and must not be a personal folder. Both guards matter:
	// a stray CMakeLists.txt on the Desktop must not produce an offer to open the Desktop.
	if (isForbiddenMemoryRoot(projectDir) || !hasProjectMarker(projectDir)) {
		return null
	}
	return projectDir
}

/**
 * Ask, once per directory, whether to open the scaffolded project now.
 *
 * Returns a sentence for the model when the developer declines or the offer is skipped, so the agent
 * knows the folder was NOT opened and can keep working with that constraint rather than assuming
 * memory will persist. Returns null when the window is about to reload (nothing left to say).
 */
export async function offerToOpenScaffoldedProject(projectDir: string): Promise<string | null> {
	if (offered.has(key(projectDir))) {
		return null
	}
	offered.add(key(projectDir))

	const name = path.basename(projectDir)
	try {
		const choice = await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: `Open ${name} now?`,
			options: {
				modal: false,
				detail:
					`The project was created at ${projectDir}, outside the folder you have open. Opening it lets ` +
					`this project keep its own memory and checkpoints, so your next session starts knowing the ` +
					`board and ports instead of finding them again.\n\n` +
					`VS Code reloads when a folder opens. This conversation is saved — reopen it from History.`,
				items: ["Open project", "Not now"],
			},
		})

		if (choice.selectedOption !== "Open project") {
			return (
				`The developer chose NOT to open ${projectDir} yet. Until they do, project memory and checkpoints ` +
				`cannot be written for it — do not retry update_project_memory for this project, and do not write ` +
				`memory anywhere else instead. Keep the relevant facts in your replies so they are not lost.`
			)
		}

		await HostProvider.workspace.openFolder({ path: projectDir, newWindow: false })
		return null
	} catch (error) {
		console.error("[scaffoldHandover] could not offer to open the project:", error)
		return null
	}
}

/** Test seam — the offer is once-per-directory for the life of the extension host. */
export function _resetOfferedForTest(): void {
	offered.clear()
}
