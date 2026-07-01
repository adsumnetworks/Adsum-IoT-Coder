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

import { CRA_ARTIFACT_DIR } from "@shared/cra-paths"
import type { WorkspaceFeatures } from "@shared/workspace-features"
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

// WorkspaceFeatures (the BLE / compliance signal shape + the MOAT INVARIANT) is the single source of truth in
// @shared/workspace-features so the host probe, the ExtensionMessage wire contract, and the webview agree.
export type { WorkspaceFeatures } from "@shared/workspace-features"

export interface ClassifierResult {
	apps: AppInfo[]
	summary: WorkspaceSummary
	features: WorkspaceFeatures
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

// BLE master-switch detectors. Anchored so a leading `#` (comment) and a trailing value/`=yes`/`=y_x`
// don't false-match — only `CONFIG_BT=y` (optional surrounding whitespace + optional inline comment).
/** nRF/Zephyr BLE master switch: `CONFIG_BT=y` in a Kconfig fragment (prj.conf / *.conf / *.overlay).
 *  Exported so the system-prompt nRF detector (iot_context) shares the SAME anchored test (no drift). */
export const NRF_BLE_RE = /^\s*CONFIG_BT\s*=\s*y\s*(#.*)?$/im
/** ESP-IDF Bluetooth enable: `CONFIG_BT_ENABLED=y` in sdkconfig / sdkconfig.defaults / build config. */
const ESP_BLE_RE = /^\s*CONFIG_BT_ENABLED\s*=\s*y\s*(#.*)?$/im

/** A folder entry whose CONTENT we read for a BLE stack signal: any *.conf / *.overlay fragment plus the
 *  two unsuffixed ESP configs. Globbing (not a fixed list) catches overlay-bt.conf, prj_<variant>.conf,
 *  boards/<board>.conf-style fragments, sysbuild.conf, etc. — where BLE is very commonly enabled. */
const BLE_CONF_EXT_RE = /\.(conf|overlay)$/i
function isBleConfigFile(name: string): boolean {
	return BLE_CONF_EXT_RE.test(name) || name === "sdkconfig" || name === "sdkconfig.defaults"
}

// Build-resolved configs (the source of truth post-build): under a build dir, nRF writes zephyr/.config and
// ESP writes config/sdkconfig. Checked inside the build scan so an overlay-only / post-build BLE project
// (CONFIG_BT merged in only at build time) still trips hasBle.
const BUILD_BLE_CONFIGS = [
	["zephyr", ".config"],
	["config", "sdkconfig"],
] as const

/** True when a file's content enables a BLE/Bluetooth stack (nRF or ESP). */
function fileEnablesBle(path: string, fs: FsAdapter): boolean {
	const content = fs.readFile(path)
	return NRF_BLE_RE.test(content) || ESP_BLE_RE.test(content)
}

// Wi-Fi signal. nRF Wi-Fi (nRF7002) is a deliberate `CONFIG_WIFI=y` opt-in → reliable from config. ESP Wi-Fi has
// no clean config flag (CONFIG_ESP_WIFI_* defaults on for Wi-Fi chips), so we detect ACTUAL usage from source —
// an esp_wifi.h include or an esp_wifi_* call — to stay honest (no false "Wi-Fi detected" on every ESP project).
/** nRF Wi-Fi master switch: `CONFIG_WIFI=y` in a Kconfig fragment. */
export const NRF_WIFI_RE = /^\s*CONFIG_WIFI\s*=\s*y\s*(#.*)?$/im
/** ESP Wi-Fi API usage in source: `#include "esp_wifi.h"` or any `esp_wifi_*(` call. */
const ESP_WIFI_SRC_RE = /\besp_wifi(\.h|_[a-z])/i
/** Source files worth scanning for esp_wifi usage. */
const WIFI_SRC_EXT_RE = /\.(c|cc|cpp|h|hpp)$/i

/** True when a config fragment enables nRF Wi-Fi (`CONFIG_WIFI=y`). */
function fileEnablesNrfWifi(path: string, fs: FsAdapter): boolean {
	return NRF_WIFI_RE.test(fs.readFile(path))
}
/** True when a source file calls the ESP Wi-Fi API. */
function fileUsesEspWifi(path: string, fs: FsAdapter): boolean {
	return ESP_WIFI_SRC_RE.test(fs.readFile(path))
}

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
	/** Capability/file-presence signals (A3/A10) — OR-accumulated across folders. */
	ble: boolean
	wifi: boolean
	compliance: boolean
}

function checkFolder(folderPath: string, fs: FsAdapter): FolderSignals {
	const s: FolderSignals = {
		nrfDefinitive: false,
		espDefinitive: false,
		nrfSupporting: 0,
		espSupporting: 0,
		ble: false,
		wifi: false,
		compliance: false,
	}

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

	const entries = fs.listDir(folderPath)

	// Capability signal — a BLE stack enabled in any config fragment (A10 deep-debug sub-line / A3 nudge).
	// Globs *.conf / *.overlay (+ sdkconfig[.defaults]) so overlay-/variant-enabled BT is caught, not just prj.conf.
	for (const entry of entries) {
		if (!isBleConfigFile(entry)) continue
		if (fileEnablesBle(join(folderPath, entry), fs)) {
			s.ble = true
			break
		}
	}

	// Wi-Fi capability — nRF `CONFIG_WIFI=y` (config) or ESP `esp_wifi` API usage (source, this folder + main/).
	for (const entry of entries) {
		if (isBleConfigFile(entry) && fileEnablesNrfWifi(join(folderPath, entry), fs)) {
			s.wifi = true
			break
		}
	}
	if (!s.wifi) {
		for (const entry of entries) {
			if (WIFI_SRC_EXT_RE.test(entry) && fileUsesEspWifi(join(folderPath, entry), fs)) {
				s.wifi = true
				break
			}
		}
	}
	if (!s.wifi) {
		const mainDir = join(folderPath, "main")
		if (fs.isDir(mainDir)) {
			for (const entry of fs.listDir(mainDir)) {
				if (WIFI_SRC_EXT_RE.test(entry) && fileUsesEspWifi(join(mainDir, entry), fs)) {
					s.wifi = true
					break
				}
			}
		}
	}

	// File-presence signal — CRA/compliance artifacts already generated (A3 nudge demotes once present).
	if (fs.isDir(join(folderPath, CRA_ARTIFACT_DIR))) s.compliance = true

	// Scan build* subdirectories for platform artifacts + the build-resolved BLE config (the source of truth).
	for (const entry of entries) {
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

		// BLE from the build-resolved config — CONFIG_BT may be merged in only at build time (overlay/board conf).
		if (!s.ble) {
			for (const parts of BUILD_BLE_CONFIGS) {
				const p = join(buildPath, ...parts)
				if (fs.exists(p) && fileEnablesBle(p, fs)) {
					s.ble = true
					break
				}
			}
		}

		// Wi-Fi from the build-resolved nRF config (CONFIG_WIFI may be merged in only at build time).
		if (!s.wifi) {
			const zc = join(buildPath, "zephyr", ".config")
			if (fs.exists(zc) && fileEnablesNrfWifi(zc, fs)) {
				s.wifi = true
			}
		}
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
	const features: WorkspaceFeatures = { hasBle: false, hasWifi: false, hasComplianceArtifacts: false }

	const visitFolder = (folderPath: string) => {
		if (seen.has(folderPath)) return
		seen.add(folderPath)

		const sig = checkFolder(folderPath, fsAdapter)
		// Capability/file-presence signals are OR-accumulated across every visited folder, independent of
		// whether the folder classifies as an app (a top-level compliance/ dir still counts).
		if (sig.ble) features.hasBle = true
		if (sig.wifi) features.hasWifi = true
		if (sig.compliance) features.hasComplianceArtifacts = true

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

	return { apps, summary, features }
}

// ---------------------------------------------------------------------------
// Cached classification — populated from extension.ts, read by the controller
// so the webview learns which platform the open workspace is.
// ---------------------------------------------------------------------------

let _cachedResult: ClassifierResult = {
	apps: [],
	summary: "none",
	features: { hasBle: false, hasWifi: false, hasComplianceArtifacts: false },
}

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

export function getCachedWorkspaceFeatures(): WorkspaceFeatures {
	return _cachedResult.features
}
