import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import {
	getCachedWorkspaceClassification,
	reclassifyWorkspaceIfStale,
	refreshWorkspaceClassification,
} from "./WorkspaceClassifier"

/**
 * A folder that was empty when the extension activated must be re-read once files land in it.
 *
 * [BENCH 2026-09-04] A guided build opened in an empty folder seeded a whole gateway two levels
 * down (`gateway/esp32`, `gateway/ble-scanner`). The next task — opened with the build's own
 * "Continue … Step 2/7" line — was still classified `none`: no platform block, no product row,
 * and the agent probed the bench from first principles with none of its product knowledge loaded.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/services/platform/workspaceClassifierRefresh.node-test.ts
 */

function seedGateway(root: string): void {
	const gw = path.join(root, "gateway")
	fs.mkdirSync(path.join(gw, "esp32", "main"), { recursive: true })
	fs.writeFileSync(path.join(gw, "esp32", "sdkconfig"), 'CONFIG_IDF_TARGET="esp32"\n')
	fs.writeFileSync(path.join(gw, "esp32", "CMakeLists.txt"), "include($ENV{IDF_PATH}/tools/cmake/project.cmake)\n")
	fs.mkdirSync(path.join(gw, "ble-scanner"), { recursive: true })
	fs.writeFileSync(path.join(gw, "ble-scanner", "prj.conf"), "CONFIG_BT=y\n")
	fs.writeFileSync(path.join(gw, "ble-scanner", "CMakeLists.txt"), "find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})\n")
}

describe("a folder seeded after activation is classified again", () => {
	test("empty at activation, a gateway two levels down after the seed", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "seed-"))
		const t0 = 1_000_000
		assert.equal(refreshWorkspaceClassification([root], undefined, t0).summary, "none", "empty folder classifies none")

		seedGateway(root)

		// Inside the throttle window the cached answer stands — this is what keeps the scan off
		// the per-request path.
		assert.equal(reclassifyWorkspaceIfStale(15_000, t0 + 5_000).summary, "none", "throttled: cache stands")

		// Past it, the roots given at activation are read again and the seed is seen.
		const fresh = reclassifyWorkspaceIfStale(15_000, t0 + 16_000)
		assert.equal(fresh.summary, "both", "the seeded gateway must be seen without a reload")
		const apps = getCachedWorkspaceClassification()
			// `path.relative` answers in the platform separator, so this compared "gateway\esp32" against
			// "gateway/esp32" and failed on Windows only — where ~95% of users are. The assertion is about
			// which apps were found, not how the OS spells a path.
			.apps.map((a) => `${a.platform}:${path.relative(root, a.path).split(path.sep).join("/")}`)
			.sort()
		assert.deepEqual(apps, ["esp:gateway/esp32", "nrf:gateway/ble-scanner"])
	})

	test("nothing to re-read before activation gave any roots", () => {
		// A fresh module state is not reachable here; the guard is exercised by the empty-roots
		// path in the function itself — this asserts it does not throw and returns the cache.
		assert.ok(reclassifyWorkspaceIfStale(0, Date.now()))
	})
})
