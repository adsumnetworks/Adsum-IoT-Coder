/**
 * Locally-runnable probe tests (node:test) for WorkspaceClassifier — the BLE/compliance feature probe + the
 * module cache. The sibling mocha suite (__tests__/WorkspaceClassifier.test.ts) covers platform classification
 * but does NOT run on the default toolchain here (node vs yargs ESM), leaving the probe with no local gate.
 * This file runs via `npm run test:workspace` (ts-node) on the same node the rest of test:cra uses.
 *
 * Deliberately OUTSIDE __tests__/ so the mocha `src/**​/__tests__/*.ts` glob never picks it up.
 */
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import {
	classifyWorkspace,
	type FsAdapter,
	getCachedWorkspaceClassification,
	getCachedWorkspaceFeatures,
	getCachedWorkspaceSummary,
	refreshWorkspaceClassification,
} from "./WorkspaceClassifier"

// In-memory FsAdapter built from a path→content map; dirs are inferred from the file paths.
function fixture(files: Record<string, string>): FsAdapter {
	const dirs = new Set<string>()
	for (const filePath of Object.keys(files)) {
		let p = filePath
		while (true) {
			const parent = p.split("/").slice(0, -1).join("/")
			if (!parent || parent === p) break
			dirs.add(parent)
			p = parent
		}
	}
	const exists = (p: string) => p in files || dirs.has(p)
	const readFile = (p: string) => files[p] ?? ""
	const isDir = (p: string) => dirs.has(p)
	const listDir = (dir: string) => {
		const entries = new Set<string>()
		const prefix = dir + "/"
		for (const p of [...Object.keys(files), ...Array.from(dirs)]) {
			if (p.startsWith(prefix)) {
				const seg = p.slice(prefix.length).split("/")[0]
				if (seg) entries.add(seg)
			}
		}
		return Array.from(entries)
	}
	return { exists, readFile, listDir, isDir }
}

const NRF = "find_package(Zephyr REQUIRED)"
const ESP = "include($ENV{IDF_PATH}/tools/cmake/project.cmake)"
const bleOf = (roots: string[], files: Record<string, string>) => classifyWorkspace(roots, fixture(files)).features.hasBle

// --- hasBle: source configs -------------------------------------------------
test("BLE from nRF prj.conf CONFIG_BT=y", () => assert.equal(bleOf(["/p"], { "/p/prj.conf": "CONFIG_BT=y\n" }), true))
test("BLE from ESP sdkconfig CONFIG_BT_ENABLED=y", () =>
	assert.equal(bleOf(["/p"], { "/p/sdkconfig": "CONFIG_BT_ENABLED=y\n" }), true))
test("BLE from sdkconfig.defaults", () => assert.equal(bleOf(["/p"], { "/p/sdkconfig.defaults": "CONFIG_BT_ENABLED=y\n" }), true))
test("BLE whitespace tolerant", () => assert.equal(bleOf(["/p"], { "/p/prj.conf": "  CONFIG_BT = y\n" }), true))

// --- hasBle: overlay / variant / sysbuild fragments (the major false-negative fix) ---
test("BLE from overlay-bt.conf (glob *.conf)", () =>
	assert.equal(bleOf(["/p"], { "/p/CMakeLists.txt": NRF, "/p/overlay-bt.conf": "CONFIG_BT=y\n" }), true))
test("BLE from prj_<variant>.conf", () =>
	assert.equal(bleOf(["/p"], { "/p/CMakeLists.txt": NRF, "/p/prj_release.conf": "CONFIG_BT=y\n" }), true))
test("BLE from sysbuild.conf", () =>
	assert.equal(bleOf(["/p"], { "/p/CMakeLists.txt": NRF, "/p/sysbuild.conf": "CONFIG_BT=y\n" }), true))

// --- hasBle: build-resolved config (source of truth post-build) -------------
test("BLE from build/zephyr/.config (nRF resolved)", () =>
	assert.equal(bleOf(["/p"], { "/p/CMakeLists.txt": NRF, "/p/build/zephyr/.config": "CONFIG_BT=y\n" }), true))
test("BLE from build/config/sdkconfig (ESP resolved)", () =>
	assert.equal(bleOf(["/p"], { "/p/CMakeLists.txt": ESP, "/p/build/config/sdkconfig": "CONFIG_BT_ENABLED=y\n" }), true))

// --- hasBle: carve-outs (no false positives) --------------------------------
test("CONFIG_BT=n → false", () => assert.equal(bleOf(["/p"], { "/p/prj.conf": "CONFIG_BT=n\n" }), false))
test("CONFIG_BT_PERIPHERAL only → false (master switch)", () =>
	assert.equal(bleOf(["/p"], { "/p/prj.conf": "CONFIG_BT_PERIPHERAL=y\n" }), false))
test("CONFIG_BT=yes → false (anchored)", () => assert.equal(bleOf(["/p"], { "/p/prj.conf": "CONFIG_BT=yes\n" }), false))
test("commented '# CONFIG_BT=y' → false", () => assert.equal(bleOf(["/p"], { "/p/prj.conf": "# CONFIG_BT=y\n" }), false))
test("inline comment 'CONFIG_BT=y # note' → true", () =>
	assert.equal(bleOf(["/p"], { "/p/prj.conf": "CONFIG_BT=y # enable BLE\n" }), true))
test("no BLE config → false", () => assert.equal(bleOf(["/p"], { "/p/prj.conf": "CONFIG_LOG=y\n" }), false))

// --- hasBle: cross-folder OR-accumulation in a mixed tree -------------------
test("accumulates hasBle across a 'both' tree (BLE in one app only)", () => {
	const r = classifyWorkspace(
		["/ws"],
		fixture({ "/ws/nrf/CMakeLists.txt": NRF, "/ws/nrf/prj.conf": "CONFIG_BT=y\n", "/ws/esp/CMakeLists.txt": ESP }),
	)
	assert.equal(r.summary, "both")
	assert.equal(r.features.hasBle, true)
})

// --- hasWifi: nRF CONFIG_WIFI opt-in + ESP esp_wifi source usage (no config-default false positives) ---
const wifiOf = (roots: string[], files: Record<string, string>) => classifyWorkspace(roots, fixture(files)).features.hasWifi
test("Wi-Fi from nRF prj.conf CONFIG_WIFI=y (nRF7002)", () =>
	assert.equal(wifiOf(["/p"], { "/p/prj.conf": "CONFIG_WIFI=y\n" }), true))
test("Wi-Fi from build/zephyr/.config (nRF resolved)", () =>
	assert.equal(wifiOf(["/p"], { "/p/CMakeLists.txt": NRF, "/p/build/zephyr/.config": "CONFIG_WIFI=y\n" }), true))
test("Wi-Fi from ESP esp_wifi.h include in main/", () =>
	assert.equal(wifiOf(["/p"], { "/p/CMakeLists.txt": ESP, "/p/main/wifi.c": '#include "esp_wifi.h"\n' }), true))
test("Wi-Fi from ESP esp_wifi_ call in a root source file", () =>
	assert.equal(wifiOf(["/p"], { "/p/CMakeLists.txt": ESP, "/p/app.c": "esp_wifi_start();\n" }), true))
test("CONFIG_WIFI=n → false", () => assert.equal(wifiOf(["/p"], { "/p/prj.conf": "CONFIG_WIFI=n\n" }), false))
test("ESP project without esp_wifi usage → false (chip defaults are not usage)", () =>
	assert.equal(wifiOf(["/p"], { "/p/CMakeLists.txt": ESP, "/p/main/main.c": "void app_main(void){}\n" }), false))
test("no Wi-Fi config or usage → false", () => assert.equal(wifiOf(["/p"], { "/p/prj.conf": "CONFIG_BT=y\n" }), false))

// --- compliance -------------------------------------------------------------
test("compliance/ dir → hasComplianceArtifacts true", () =>
	assert.equal(
		classifyWorkspace(["/p"], fixture({ "/p/CMakeLists.txt": NRF, "/p/compliance/sbom/a.json": "{}" })).features
			.hasComplianceArtifacts,
		true,
	))
test("compliance/ in a depth-1 app folder", () =>
	assert.equal(
		classifyWorkspace(["/ws"], fixture({ "/ws/app/CMakeLists.txt": NRF, "/ws/app/compliance/cra-remediation.md": "#" }))
			.features.hasComplianceArtifacts,
		true,
	))
test("no compliance/ dir → false", () =>
	assert.equal(classifyWorkspace(["/p"], fixture({ "/p/prj.conf": "CONFIG_BT=y\n" })).features.hasComplianceArtifacts, false))

// --- findArtifact depth boundary (maxDepth = 6, build root = depth 0) -------
test("ncs_version.h exactly at maxDepth=6 → found (nrf)", () =>
	assert.equal(
		classifyWorkspace(["/p"], fixture({ "/p/build/a/b/c/d/e/f/ncs_version.h": '#define NCS_VERSION_STRING "3.2.1"' }))
			.summary,
		"nrf",
	))
test("ncs_version.h one past maxDepth (depth 7) → not found (none)", () =>
	assert.equal(
		classifyWorkspace(["/p"], fixture({ "/p/build/a/b/c/d/e/f/g/ncs_version.h": '#define NCS_VERSION_STRING "3.2.1"' }))
			.summary,
		"none",
	))

// --- cache layer (refresh replaces, accessors reflect) ----------------------
test("refresh replaces (not merges) the cached result", () => {
	refreshWorkspaceClassification(["/p"], fixture({ "/p/CMakeLists.txt": NRF, "/p/prj.conf": "CONFIG_BT=y\n" }))
	assert.equal(getCachedWorkspaceSummary(), "nrf")
	assert.equal(getCachedWorkspaceFeatures().hasBle, true)

	refreshWorkspaceClassification(["/e"], fixture({ "/e/CMakeLists.txt": ESP }))
	assert.equal(getCachedWorkspaceSummary(), "esp")
	assert.equal(getCachedWorkspaceFeatures().hasBle, false) // not carried over
	assert.equal(
		getCachedWorkspaceClassification().apps.some((a) => a.platform === "nrf"),
		false,
	)
})
test("refresh to an empty workspace resets to defaults", () => {
	refreshWorkspaceClassification(["/x"], fixture({}))
	assert.equal(getCachedWorkspaceSummary(), "none")
	assert.deepEqual(getCachedWorkspaceFeatures(), { hasBle: false, hasWifi: false, hasComplianceArtifacts: false })
})

// --- MOAT guard: the capability/conformity signal must never reach the model-prompt path ---------
test("MOAT: getCachedWorkspaceFeatures / hasComplianceArtifacts are never read under src/core/prompts", () => {
	const promptsDir = join(process.cwd(), "src", "core", "prompts")
	const offenders: string[] = []
	for (const entry of readdirSync(promptsDir, { recursive: true })) {
		const rel = String(entry)
		if (!/\.(ts|tsx)$/.test(rel) || rel.includes("__tests__") || rel.includes("__snapshots__")) {
			continue
		}
		const content = readFileSync(join(promptsDir, rel), "utf8")
		if (/getCachedWorkspaceFeatures|hasComplianceArtifacts/.test(content)) {
			offenders.push(rel)
		}
	}
	// getCachedWorkspaceSummary (platform route) + NRF_BLE_RE (a regex) stay allowed — only the capability
	// signal is fenced. If this fails, a prompt-path file started reading workspaceFeatures (moat breach).
	assert.deepEqual(offenders, [], `prompt-path must not read workspaceFeatures: ${offenders.join(", ")}`)
})
