/**
 * WorkspaceClassifier — detects which embedded platform(s) are present in the open workspace.
 *
 * Scans each workspace root and its subfolders to depth 2. Classification is based on
 * definitive signals (any one is enough) and supporting signals (need 2+). Crucially the
 * definitive anchor is CMakeLists.txt *content* rather than presence alone — a bare
 * CMakeLists.txt could belong to any C project; `find_package(Zephyr` or the IDF cmake
 * include are unambiguous platform markers.
 *
 * Build artifacts are also definitive: build_info.yml in a build/ tree = NCS; flasher_args.json
 * or project_description.json at build root = ESP-IDF.
 *
 * All I/O goes through the injected FsAdapter so the classifier is fully unit-testable with
 * fixture trees — no filesystem side effects in tests.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"

export type Platform = "nrf" | "esp"
export type WorkspaceSummary = "nrf" | "esp" | "both" | "none"

export interface AppInfo {
	/** Absolute path to the application folder. */
	path: string
	platform: Platform
	confidence: "definitive" | "supporting"
}

export interface ClassifierResult {
	apps: AppInfo[]
	summary: WorkspaceSummary
}

// ---------------------------------------------------------------------------
// Filesystem adapter (injected for tests)
// ---------------------------------------------------------------------------

export interface FsAdapter {
	exists: (p: string) => boolean
	readFile: (p: string) => string
	listDir: (p: string) => string[]
	isDir: (p: string) => boolean
}

export const realFsAdapter: FsAdapter = {
	exists: existsSync,
	readFile: (p) => {
		try {
			return readFileSync(p, "utf8")
		} catch {
			return ""
		}
	},
	listDir: (p) => {
		try {
			return readdirSync(p)
		} catch {
			return []
		}
	},
	isDir: (p) => {
		try {
			return statSync(p).isDirectory()
		} catch {
			return false
		}
	},
}

// ---------------------------------------------------------------------------
// Detection signals
// ---------------------------------------------------------------------------

/** CMakeLists.txt contains find_package(Zephyr — the canonical Zephyr/NCS entrypoint. */
const NRF_CMAKE_RE = /find_package\s*\(\s*Zephyr/

/**
 * CMakeLists.txt includes the ESP-IDF project CMake — the canonical ESP-IDF entrypoint.
 * Matches: include($ENV{IDF_PATH}/tools/cmake/project.cmake) in its various quoting forms.
 */
const ESP_CMAKE_RE = /IDF_PATH[}"']*\/tools\/cmake\/project\.cmake/

/** Folders to never descend into. */
const SKIP_DIRS = new Set([
	"managed_components",
	"node_modules",
	".git",
	".west",
	"toolchain",
	"__pycache__",
	".cache",
	".venv",
	"venv",
])

function isBuildDir(name: string): boolean {
	return name.startsWith("build")
}

// ---------------------------------------------------------------------------
// Per-folder signal counting
// ---------------------------------------------------------------------------

interface FolderSignals {
	nrfDefinitive: boolean
	espDefinitive: boolean
	nrfSupporting: number
	espSupporting: number
}

function checkFolder(folderPath: string, fs: FsAdapter): FolderSignals {
	const s: FolderSignals = { nrfDefinitive: false, espDefinitive: false, nrfSupporting: 0, espSupporting: 0 }

	// CMakeLists.txt content (the most reliable definitive signal)
	const cmakePath = join(folderPath, "CMakeLists.txt")
	if (fs.exists(cmakePath)) {
		const cmake = fs.readFile(cmakePath)
		if (NRF_CMAKE_RE.test(cmake)) s.nrfDefinitive = true
		if (ESP_CMAKE_RE.test(cmake)) s.espDefinitive = true
	}

	// NRF supporting files
	if (fs.exists(join(folderPath, "prj.conf"))) s.nrfSupporting++
	if (fs.exists(join(folderPath, "west.yml"))) s.nrfSupporting++
	if (fs.exists(join(folderPath, ".west"))) s.nrfSupporting++
	if (fs.exists(join(folderPath, "sample.yaml"))) s.nrfSupporting++
	if (fs.exists(join(folderPath, "testcase.yaml"))) s.nrfSupporting++

	// ESP supporting files
	if (fs.exists(join(folderPath, "sdkconfig"))) s.espSupporting++
	if (fs.exists(join(folderPath, "sdkconfig.defaults"))) s.espSupporting++
	if (fs.exists(join(folderPath, "idf_component.yml"))) s.espSupporting++
	if (fs.exists(join(folderPath, "dependencies.lock"))) s.espSupporting++
	if (fs.exists(join(folderPath, "Kconfig.projbuild"))) s.espSupporting++
	if (fs.exists(join(folderPath, "main", "CMakeLists.txt"))) s.espSupporting++

	// Scan build* subdirectories for platform-specific artifacts
	for (const entry of fs.listDir(folderPath)) {
		if (!isBuildDir(entry)) continue
		const buildPath = join(folderPath, entry)
		if (!fs.isDir(buildPath)) continue

		// NRF: build_info.yml or ncs_version.h anywhere under build/ (depth ≤ 6)
		if (findArtifact(buildPath, ["build_info.yml", "ncs_version.h"], fs, 0, 6)) {
			s.nrfDefinitive = true
		}
		// ESP: project_description.json or flasher_args.json directly under build/
		if (fs.exists(join(buildPath, "project_description.json"))) s.espDefinitive = true
		if (fs.exists(join(buildPath, "flasher_args.json"))) s.espDefinitive = true
	}

	return s
}

/** Recursive depth-bounded search for any file whose name is in `names`. */
function findArtifact(dir: string, names: string[], fs: FsAdapter, depth: number, maxDepth: number): boolean {
	if (depth > maxDepth) return false
	for (const entry of fs.listDir(dir)) {
		if (names.includes(entry)) return true
		const full = join(dir, entry)
		if (fs.isDir(full) && findArtifact(full, names, fs, depth + 1, maxDepth)) return true
	}
	return false
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify what embedded platform(s) are present in the given workspace roots.
 *
 * Scans each root and its direct children + grandchildren (depth ≤ 2), skipping
 * build/, node_modules/, .git/, and toolchain trees. Returns a deduped list of
 * detected app folders and a one-word summary ("nrf" | "esp" | "both" | "none").
 */
export function classifyWorkspace(roots: string[], fsAdapter: FsAdapter = realFsAdapter): ClassifierResult {
	const apps: AppInfo[] = []
	const seen = new Set<string>()

	const visitFolder = (folderPath: string) => {
		if (seen.has(folderPath)) return
		seen.add(folderPath)

		const sig = checkFolder(folderPath, fsAdapter)
		const isNrf = sig.nrfDefinitive || sig.nrfSupporting >= 2
		const isEsp = sig.espDefinitive || sig.espSupporting >= 2

		if (isNrf) {
			apps.push({ path: folderPath, platform: "nrf", confidence: sig.nrfDefinitive ? "definitive" : "supporting" })
		}
		if (isEsp) {
			apps.push({ path: folderPath, platform: "esp", confidence: sig.espDefinitive ? "definitive" : "supporting" })
		}
	}

	const scanSubfolders = (dir: string, depth: number) => {
		if (depth > 2) return
		for (const entry of fsAdapter.listDir(dir)) {
			// Skip build dirs (they're artifact caches, not source app roots) and known non-app dirs
			if (SKIP_DIRS.has(entry) || isBuildDir(entry)) continue
			const full = join(dir, entry)
			if (!fsAdapter.isDir(full)) continue
			visitFolder(full)
			scanSubfolders(full, depth + 1)
		}
	}

	for (const root of roots) {
		visitFolder(root)
		scanSubfolders(root, 1)
	}

	const platforms = new Set(apps.map((a) => a.platform))
	let summary: WorkspaceSummary = "none"
	if (platforms.has("nrf") && platforms.has("esp")) summary = "both"
	else if (platforms.has("nrf")) summary = "nrf"
	else if (platforms.has("esp")) summary = "esp"

	return { apps, summary }
}

// ---------------------------------------------------------------------------
// Cached classification — populated from extension.ts, read by the controller
// so the webview learns which platform the open workspace is.
// ---------------------------------------------------------------------------

let _cachedResult: ClassifierResult = { apps: [], summary: "none" }

/** Re-run classification for the given roots and cache it. Returns the fresh result. */
export function refreshWorkspaceClassification(roots: string[], fsAdapter: FsAdapter = realFsAdapter): ClassifierResult {
	_cachedResult = classifyWorkspace(roots, fsAdapter)
	return _cachedResult
}

export function getCachedWorkspaceClassification(): ClassifierResult {
	return _cachedResult
}

export function getCachedWorkspaceSummary(): WorkspaceSummary {
	return _cachedResult.summary
}
