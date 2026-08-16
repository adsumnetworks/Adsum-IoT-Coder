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
		return path
			.resolve(p)
			.replace(/[\\/]+$/, "")
			.toLowerCase()
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

	if (apps.length > 1) {
		// Several apps: the shared layer is their COMMON PARENT, not the open folder.
		//
		// A container that groups apps usually has no marker of its own — a real prototype
		// (`asset_tag/` holding `tag/` and `locator/`) is just a folder with two Zephyr apps inside.
		// Requiring a marker there left cross-app knowledge with nowhere to go, and a note about both
		// apps ended up on the Desktop. Grouping two real apps is itself the evidence that the parent
		// is a project.
		//
		// Using the common parent rather than `cwd` is what keeps the Desktop out: with the Desktop
		// open and one app below it, the parent is the app's own folder, never the Desktop.
		const shared = commonParent(apps)
		if (shared && !isForbiddenMemoryRoot(shared) && !apps.includes(shared)) {
			out.push(shared)
		}
	} else if (apps.length === 0 && canHoldMemory(cwd)) {
		// No apps detected, but the open folder is itself a project — a single-app repo opened directly.
		out.push(cwd as string)
	}

	for (const a of apps) {
		if (!out.includes(a)) {
			out.push(a)
		}
	}
	return out
}

/** Deepest directory containing all the given paths, or undefined when they share no useful ancestor. */
export function commonParent(dirs: string[]): string | undefined {
	if (dirs.length === 0) {
		return undefined
	}
	const split = dirs.map((d) => path.resolve(d).split(/[\\/]/))
	const first = split[0]
	const shared: string[] = []
	for (let i = 0; i < first.length; i++) {
		if (split.every((parts) => parts[i]?.toLowerCase() === first[i]?.toLowerCase())) {
			shared.push(first[i])
		} else {
			break
		}
	}
	// A single segment is a drive root ("e:") or the filesystem root — not a project.
	return shared.length > 1 ? shared.join(path.sep) : undefined
}
