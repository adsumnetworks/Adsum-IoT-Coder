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
import { commonParent, hasProjectMarker, isForbiddenMemoryRoot } from "@/core/memory/workspace/projectAnchor"

/** Files whose creation means "a project now lives in this directory". */
const SCAFFOLD_MARKERS = new Set(["prj.conf", "CMakeLists.txt", "sdkconfig", "sdkconfig.defaults", "west.yml"])

/** Directories already offered this session — the offer must never become a second interruption. */
const offered = new Set<string>()

/** Every project dir scaffolded this task. Keyed by task so two tasks cannot cross wires. */
const pendingByTask = new Map<string, Set<string>>()

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
 * visible, because the run is still in progress and a dialog mid-scaffold interrupts it.
 */
export function notePendingScaffold(taskId: string, projectDir: string): void {
	const set = pendingByTask.get(taskId) ?? new Set<string>()
	set.add(path.resolve(projectDir))
	pendingByTask.set(taskId, set)
}

/**
 * The single folder to open for this task, or undefined if nothing was scaffolded.
 *
 * The CONTAINER wins, not the deepest app. A two-chip scaffold writes markers in `gw/ble-scanner` and
 * `gw/wifi-forwarder`; opening one of them hides the other and breaks the shared memory layer that
 * holds the contract between them. Opening `gw/` shows both and lets memory anchor per-app underneath.
 * With a single app there is nothing above it, so the app itself is the container.
 */
export function pendingScaffold(taskId: string): string | undefined {
	const dirs = [...(pendingByTask.get(taskId) ?? [])]
	if (dirs.length === 0) {
		return undefined
	}
	if (dirs.length === 1) {
		return dirs[0]
	}
	const shared = commonParent(dirs)
	// A common parent that is a personal folder (two prototypes both under the Desktop) is not a
	// container — fall back to the shallowest real project rather than offering to open the Desktop.
	if (shared && !isForbiddenMemoryRoot(shared)) {
		return shared
	}
	return dirs.sort((a, b) => a.length - b.length)[0]
}

/** Forget this task's pending scaffold — called once the handover has been raised. */
export function clearPendingScaffold(taskId: string): void {
	pendingByTask.delete(taskId)
}

/**
 * The chat message shown beside the "Open project folder" button.
 *
 * Says the three things a developer needs and cannot infer: where the project is, that opening is
 * required for the project to keep its memory, and — the one that is genuinely surprising — that the
 * window reloads and this conversation continues from History.
 */
export function scaffoldHandoverMessage(projectDir: string): string {
	return (
		`Your project is scaffolded at ${projectDir}.\n\n` +
		`Open that folder to continue. Until it is open, this project has nowhere to keep its memory or ` +
		`checkpoints, so the next session would start over — re-detecting the board and ports it has ` +
		`already found.\n\n` +
		`Opening the folder reloads VS Code and closes this chat. It is saved: reopen it from the ` +
		`History button at the top of the Adsum panel and carry on from here.`
	)
}

/** Test seam. */
export function _resetOfferedForTest(): void {
	offered.clear()
	pendingByTask.clear()
}
