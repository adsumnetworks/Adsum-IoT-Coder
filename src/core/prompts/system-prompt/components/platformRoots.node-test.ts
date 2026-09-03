import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, test } from "node:test"
import { refreshWorkspaceClassification } from "@/services/platform/WorkspaceClassifier"
import { resolvePlatformRoots } from "./iot_context"

/**
 * Which directory each platform's knowledge is built from.
 *
 * [BENCH 2026-09-03] A LEW840X gateway workspace loaded ZERO platform bits and ZERO product bits.
 * Its ESP application is in `esp32/` and its Zephyr applications in `ble-scanner/`, so the
 * workspace ROOT has no `sdkconfig` and no `prj.conf` and both cwd probes failed — while the
 * classifier, which scans to depth 2, had already correctly said `both`. With the boards
 * unplugged the hardware fallback could not rescue it either, so the agent was never told its own
 * product knowledge existed and answered from the source instead.
 *
 * Run: npx ts-node --transpile-only -P tsconfig.unit-test.json src/core/prompts/system-prompt/components/platformRoots.node-test.ts
 */

/** A gateway on disk: nothing at the root, an IDF app and a Zephyr app one level down. */
function gatewayWorkspace(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"))
	fs.mkdirSync(path.join(root, "esp32", "main"), { recursive: true })
	fs.writeFileSync(path.join(root, "esp32", "sdkconfig"), 'CONFIG_IDF_TARGET="esp32"\n')
	fs.writeFileSync(path.join(root, "esp32", "CMakeLists.txt"), "include($ENV{IDF_PATH}/tools/cmake/project.cmake)\n")
	fs.mkdirSync(path.join(root, "ble-scanner"), { recursive: true })
	fs.writeFileSync(path.join(root, "ble-scanner", "prj.conf"), "CONFIG_BT=y\n")
	fs.writeFileSync(path.join(root, "ble-scanner", "CMakeLists.txt"), "find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})\n")
	return root
}

describe("a gateway workspace can reach its own knowledge", () => {
	test("both roots resolve to the application folders, not the empty root", async () => {
		const root = gatewayWorkspace()
		const summary = refreshWorkspaceClassification([root]).summary
		assert.equal(summary, "both", "the classifier must see both platforms — the rest is meaningless otherwise")

		const { nrfRoot, espRoot } = await resolvePlatformRoots(root)
		assert.equal(espRoot, path.join(root, "esp32"), "ESP knowledge must build from the IDF app, not the bare root")
		assert.equal(nrfRoot, path.join(root, "ble-scanner"), "nRF knowledge must build from the Zephyr app")
	})

	test("a single-app workspace still resolves to cwd — the fast path is unchanged", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "app-"))
		fs.writeFileSync(path.join(root, "prj.conf"), "CONFIG_BT=y\n")
		refreshWorkspaceClassification([root])
		const { nrfRoot } = await resolvePlatformRoots(root)
		assert.equal(nrfRoot, root)
	})

	/** An empty workspace must stay empty: this fix must not invent a platform that is not there. */
	test("an empty workspace resolves to nothing", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "empty-"))
		refreshWorkspaceClassification([root])
		const { nrfRoot, espRoot } = await resolvePlatformRoots(root)
		assert.equal(nrfRoot, undefined)
		assert.equal(espRoot, undefined)
	})
})
