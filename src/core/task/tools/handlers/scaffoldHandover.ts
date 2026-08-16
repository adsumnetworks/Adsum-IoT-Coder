/**
 * Offer to OPEN a project the agent just scaffolded, once the scaffolding is FINISHED.
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
 * WHEN it is offered matters as much as whether. The first version asked the moment a project marker
 * was written — and CMakeLists.txt is written near the START of scaffolding, so the dialog interrupted
 * the agent mid-run, while more files were still being created. Reported: "it should ask to open the
 * project after he finished the scaffolding … not randomly when he's writing some files." So writes
 * only RECORD the directory; the offer is made once, at task completion, when there is nothing left to
 * interrupt.
 *
 * Opening a folder RELOADS the window and ends the running task, which is why the developer is told —
 * plainly, before choosing — that the conversation continues from History.
 */
import * as path from "node:path"
import { ShowMessageType } from "@shared/proto/host/window"
import { hasProjectMarker, isForbiddenMemoryRoot } from "@/core/memory/workspace/projectAnchor"
import { HostProvider } from "@/hosts/host-provider"

/** Files whose creation means "a project now lives in this directory". */
const SCAFFOLD_MARKERS = new Set(["prj.conf", "CMakeLists.txt", "sdkconfig", "sdkconfig.defaults", "west.yml"])

/** Directories already offered this session — the offer must never become a second interruption. */
const offered = new Set<string>()

/** Scaffolded this task, awaiting the end of the run. Keyed by task so two tasks cannot cross wires. */
const pendingByTask = new Map<string, string>()

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
 * Record that a project was scaffolded here. Called on every marker write; deliberately does nothing
 * visible, because the run is still in progress.
 *
 * The DEEPEST directory wins. A scaffold writes several markers (a west.yml at the top, a CMakeLists
 * and prj.conf in the app), and the app folder is the one that should be opened — it is where memory
 * and the build actually belong.
 */
export function notePendingScaffold(taskId: string, projectDir: string): void {
	const current = pendingByTask.get(taskId)
	if (!current || projectDir.length > current.length) {
		pendingByTask.set(taskId, projectDir)
	}
}

/** Whatever was scaffolded this task and not yet offered, or undefined. Exported for tests. */
export function pendingScaffold(taskId: string): string | undefined {
	return pendingByTask.get(taskId)
}

/**
 * Offer to open the scaffolded project. Called ONCE, at the end of the run.
 *
 * Returns a sentence for the model when the developer declines, so the agent knows the folder was NOT
 * opened and does not assume memory will persist. Returns null when nothing was scaffolded, when the
 * offer was already made, or when the window is about to reload.
 */
export async function offerPendingScaffoldHandover(taskId: string): Promise<string | null> {
	const projectDir = pendingByTask.get(taskId)
	if (!projectDir) {
		return null
	}
	pendingByTask.delete(taskId)
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
					`Your project is ready at ${projectDir}, but it is not the folder you have open.\n\n` +
					`Opening it lets this project keep its own memory and checkpoints, so the next session starts ` +
					`knowing your board and ports instead of finding them again.\n\n` +
					`WHAT HAPPENS NEXT: VS Code reloads when the folder opens, which closes this chat. It is saved — ` +
					`reopen it from the History button at the top of the Adsum panel, and carry on where you left off.`,
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
	pendingByTask.clear()
}
