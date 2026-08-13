import * as fs from "fs"
import * as os from "os"
import * as path from "path"

/**
 * WHERE memory is allowed to live.
 *
 * THE BUG THIS EXISTS TO FIX (2026-08-13): every memory path was resolved from `cwd`. During the
 * prototype flow the developer starts with no folder open, so `cwd` is the Desktop — and the agent
 * wrote a full `.adsum/` there: PROJECT.md, status.json, and a researched note about Minew tag
 * payloads. The knowledge was real and it went somewhere the project that owns it will never look.
 *
 * The mistake was conceptual: **`cwd` is not "the project"**. It is wherever the editor happens to be
 * pointed, which during scaffolding is someone's home or Desktop. Memory has to be anchored to a
 * project, and when there is no project it must write nothing at all rather than pick a folder.
 */

/**
 * Files that mean "a real project lives here". Deliberately broad — memory in a slightly wrong
 * subfolder is recoverable; memory in the Desktop is litter.
 */
const PROJECT_MARKERS = [
	// nRF Connect SDK / Zephyr
	"prj.conf",
	"west.yml",
	"CMakeLists.txt",
	"Kconfig",
	// ESP-IDF
	"sdkconfig",
	"sdkconfig.defaults",
	// generic
	".git",
	"package.json",
	"platformio.ini",
	"Cargo.toml",
	"pyproject.toml",
	"Makefile",
]

/**
 * Directories memory must never be created in, however the path was arrived at.
 *
 * A marker check alone is not enough: a home directory can easily contain a stray `Makefile` or a
 * `.git`, and `~/Desktop` is exactly where the failure happened. These are matched by identity, not
 * by name, so a legitimate project that happens to be called "documents" is unaffected.
 */
function forbiddenRoots(): string[] {
	const home = os.homedir()
	const roots = [
		home,
		path.join(home, "Desktop"),
		path.join(home, "Documents"),
		path.join(home, "Downloads"),
		path.join(home, "Pictures"),
		path.join(home, "Music"),
		path.join(home, "Videos"),
		path.join(home, "OneDrive"),
		os.tmpdir(),
	]
	// Every drive/filesystem root: C:\, E:\, / …
	try {
		const parsed = path.parse(home)
		roots.push(parsed.root)
	} catch {
		// ignore
	}
	return roots.filter(Boolean).map(normalize)
}

function normalize(p: string): string {
	try {
		return path.resolve(p).replace(/[\\/]+$/, "").toLowerCase()
	} catch {
		return p.toLowerCase()
	}
}

/** True when this exact directory is a place memory must never be written. */
export function isForbiddenMemoryRoot(dir: string | undefined): boolean {
	if (!dir) {
		return true
	}
	const target = normalize(dir)
	// Also treat a bare drive root ("e:") as forbidden.
	if (/^[a-z]:$/.test(target) || target === "") {
		return true
	}
	return forbiddenRoots().includes(target)
}

/** True when the directory looks like it actually holds a project. */
export function hasProjectMarker(dir: string | undefined): boolean {
	if (!dir) {
		return false
	}
	for (const marker of PROJECT_MARKERS) {
		try {
			if (fs.existsSync(path.join(dir, marker))) {
				return true
			}
		} catch {
			// unreadable — treat as absent
		}
	}
	return false
}

/**
 * May memory be written here?
 *
 * Both conditions must hold: not a personal/system folder, AND something that marks a project. When
 * this returns false the caller must write NOTHING — no scaffold, no files. A scratch chat with no
 * project simply has no project memory, which is the honest outcome.
 */
export function canHoldMemory(dir: string | undefined): boolean {
	return !!dir && !isForbiddenMemoryRoot(dir) && hasProjectMarker(dir)
}

/**
 * Resolve the directory memory should be anchored to, given the workspace root and any application
 * folders the classifier detected.
 *
 * - a single detected app  → that app's folder (memory sits with the code it describes)
 * - several detected apps  → the workspace root, when it can hold memory: the shared layer for a
 *                            multi-app repo, e.g. a gateway holding ble-scanner and wifi-forwarder
 * - none detected          → the workspace root, only if it can hold memory
 * - nothing suitable       → undefined, meaning "do not write memory"
 */
export function resolveMemoryAnchor(cwd: string | undefined, appPaths: string[] = []): string | undefined {
	const apps = appPaths.filter((p) => canHoldMemory(p))
	if (apps.length === 1) {
		return apps[0]
	}
	if (apps.length > 1) {
		return canHoldMemory(cwd) ? cwd : apps[0]
	}
	return canHoldMemory(cwd) ? cwd : undefined
}

/**
 * Every directory that should carry its own memory.
 *
 * For a multi-app repo this is the shared root plus one per app, so a gateway gets
 * `gw/.adsum` (goal, cross-chip contract) alongside `gw/ble-scanner/.adsum` and
 * `gw/wifi-forwarder/.adsum` (board, transport, defects for that app). Order is stable and
 * shared-first.
 */
export function memoryAnchors(cwd: string | undefined, appPaths: string[] = []): string[] {
	const out: string[] = []
	const apps = appPaths.filter((p) => canHoldMemory(p)).sort()
	// The shared layer only earns its own memory when it is a project in its own right AND there is
	// more than one app under it — otherwise it would duplicate the single app's memory.
	if (canHoldMemory(cwd) && (apps.length > 1 || apps.length === 0)) {
		out.push(cwd as string)
	}
	for (const a of apps) {
		if (!out.includes(a)) {
			out.push(a)
		}
	}
	return out
}
