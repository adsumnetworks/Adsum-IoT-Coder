import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import * as path from "path"
import { ExtensionRegistryInfo } from "@/registry"

// ── Module-level singleton, set once during extension activation ──────────────

let _extensionPath: string | null = null
let _globalStoragePath: string | null = null

/**
 * Call once from src/common.ts activate() before any demo can be triggered.
 * Accepts plain strings so this module stays host-agnostic (no vscode import).
 *   extensionPath    = context.extensionPath
 *   globalStoragePath = context.globalStorageUri.fsPath
 */
export function initDemoManager(extensionPath: string, globalStoragePath: string): void {
	_extensionPath = extensionPath
	_globalStoragePath = globalStoragePath
}

// ── Public API ────────────────────────────────────────────────────────────────

const SCENARIO_ID = "nus-uart"

/** Prefix embedded in the webview task text to trigger the real demo flow. */
export const DEMO_TRIGGER = "[ADSUM_DEMO:nus-uart]"

export interface DemoWorkspace {
	/** Absolute path to the demo root in globalStorage (writable). */
	rootPath: string
	/** Absolute path to the central_uart project. */
	centralPath: string
	/** Absolute path to the peripheral_uart project. */
	peripheralPath: string
}

/**
 * Ensures the bundled NUS demo sample is copied to a writable location in
 * globalStorage. The extension install dir is read-only, so the agent needs
 * to read from the copied location (where `west build` can also write later).
 *
 * Returns paths the extension host uses to build the agent's task prompt so
 * the agent calls read_file on real files rather than pasted snippets.
 */
export async function prepareDemoWorkspace(): Promise<DemoWorkspace> {
	if (!_extensionPath || !_globalStoragePath) {
		throw new Error("DemoManager not initialized — call initDemoManager() in activate()")
	}

	const version = ExtensionRegistryInfo.version
	const demoRoot = path.join(_globalStoragePath, "demo", `${SCENARIO_ID}-${version}`)
	const centralPath = path.join(demoRoot, "central_uart")
	const peripheralPath = path.join(demoRoot, "peripheral_uart")

	// Copy once per extension version; reuse on subsequent runs so prior builds persist.
	if (!(await fileExistsAtPath(demoRoot))) {
		const bundledRoot = path.join(_extensionPath, "demo-scenarios", SCENARIO_ID)
		await copyDir(bundledRoot, demoRoot)
	}

	return { rootPath: demoRoot, centralPath, peripheralPath }
}

/** Builds the full agent task prompt pointing at real files in globalStorage. */
export function buildDemoPrompt(ws: DemoWorkspace): string {
	const workflowFile = path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "workflows", "demo-debug.md")
	const bleFile = path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "sdks", "ncs", "protocols", "BLE.md")
	const centralLog = path.join(ws.centralPath, "logs", "rtt", "central_683907940_20260606_162933.log")
	const peripheralLog = path.join(ws.peripheralPath, "logs", "rtt", "peripheral_960167369_20260606_162933.log")
	const centralSrc = path.join(ws.centralPath, "src", "main.c")
	const peripheralSrc = path.join(ws.peripheralPath, "src", "main.c")

	return `Demo: BLE NUS one-directional bug — no setup needed

[ADSUM_DEMO:nus-uart] You are debugging a real NCS workspace. \
Use read_file to load all six files below — do NOT skip any read. \
Logs were captured from real nRF52840DK (central) + nRF5340DK (peripheral) hardware.

Files to read (in order — read all before forming any conclusion):
1. Debugging guide:    ${workflowFile}
2. Central RTT log:    ${centralLog}
3. Peripheral RTT log: ${peripheralLog}
4. BLE protocol ref:   ${bleFile}
5. Central source:     ${centralSrc}
6. Peripheral source:  ${peripheralSrc}

After reading all six files, walk the developer through what you found — set the scene, show the evidence, trace the cause, and present the fix.
Be direct and educational — you are showing a developer a real nRF bug.

End your final message with exactly — nothing after it: <!--TASK_COMPLETE-->`
}

// ── Private helpers ───────────────────────────────────────────────────────────

/** Recursively copy a directory. */
async function copyDir(src: string, dest: string): Promise<void> {
	await fs.mkdir(dest, { recursive: true })
	const entries = await fs.readdir(src, { withFileTypes: true })
	await Promise.all(
		entries.map(async (entry) => {
			const srcPath = path.join(src, entry.name)
			const destPath = path.join(dest, entry.name)
			if (entry.isDirectory()) {
				await copyDir(srcPath, destPath)
			} else {
				await fs.copyFile(srcPath, destPath)
			}
		}),
	)
}
