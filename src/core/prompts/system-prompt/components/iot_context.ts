import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { getCachedEspEnvironment } from "@/services/esp/EspEnvironmentDetector"
import { deriveIdFromRel, loadBit } from "@/services/knowledge/KnowledgeResolver"
import { stripFrontmatter } from "@/services/knowledge/kbit/frontmatter"
import { routePlatform } from "@/services/platform/platformRouting"
import { getCachedWorkspaceSummary, NRF_BLE_RE } from "@/services/platform/WorkspaceClassifier"
import { fileExistsAtPath } from "@/utils/fs"
// import { IotProjectMemoryManager } from "../../../memory/IotProjectMemoryManager"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

async function readKnowledgeFile(relativePath: string): Promise<string> {
	try {
		const extPath = HostProvider.get().extensionFsPath
		const fullPath = path.join(extPath, "iot-knowledge", relativePath)
		if (await fileExistsAtPath(fullPath)) {
			// Strip any K-bit frontmatter so a migrated bit's YAML metadata never enters the prompt.
			return stripFrontmatter(await fs.readFile(fullPath, "utf-8"))
		}
	} catch (e) {
		console.error(`Failed to read IoT knowledge file: ${relativePath}`, e)
	}
	return ""
}

/**
 * Load a bundled bit by its stable id via the KnowledgeResolver (manifest-backed), falling
 * back to a direct path read if the id isn't in the manifest — so resolution is id-based but
 * never regresses if the manifest is missing/stale. Both paths strip frontmatter.
 */
async function loadKnowledge(id: string, fallbackPath: string): Promise<string> {
	const viaId = await loadBit(id)
	return viaId || (await readKnowledgeFile(fallbackPath))
}

/**
 * Detect if the workspace is a Zephyr / nRF Connect SDK project.
 *
 * A standard NCS application has:
 *   - prj.conf            (Kconfig — always present)
 *   - CMakeLists.txt       (with `find_package(Zephyr ...)`  )
 *   - src/main.c           (application entry point)
 *
 * Note: `west.yml` lives inside the SDK install (e.g. ~/ncs/v3.2.1/nrf/west.yml),
 *       NOT inside individual application projects, so it must NOT be used
 *       as a workspace-level detection signal.
 */
async function detectNrfPlatform(cwd: string): Promise<boolean> {
	const prjConfPath = path.join(cwd, "prj.conf")
	const hasPrjConf = await fileExistsAtPath(prjConfPath)
	if (!hasPrjConf) {
		return false
	}

	// Secondary confirmation: check CMakeLists.txt for Zephyr reference
	const cmakePath = path.join(cwd, "CMakeLists.txt")
	if (await fileExistsAtPath(cmakePath)) {
		try {
			const cmakeContent = await fs.readFile(cmakePath, "utf-8")
			if (cmakeContent.includes("Zephyr") || cmakeContent.includes("zephyr")) {
				return true
			}
		} catch {
			// If we can't read CMakeLists, fall through
		}
	}

	// prj.conf alone is a strong enough signal for Zephyr/NCS projects
	return true
}

/**
 * Scan workspace for ALL build directories containing build_info.yml.
 * Build dirs can have any name (build, build_52840, build_central, etc.)
 * Returns array of { dir, boardTarget } for all builds found.
 */
async function findAllBuildInfos(cwd: string): Promise<Array<{ dir: string; boardTarget: string | null }>> {
	const results: Array<{ dir: string; boardTarget: string | null }> = []

	try {
		const entries = await fs.readdir(cwd, { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isDirectory()) continue

			const buildInfoPath = path.join(cwd, entry.name, "build_info.yml")
			try {
				if (await fileExistsAtPath(buildInfoPath)) {
					const content = await fs.readFile(buildInfoPath, "utf-8")
					const boardMatch = content.match(/board:\s*(\S+)/i)
					results.push({
						dir: entry.name,
						boardTarget: boardMatch ? boardMatch[1] : null,
					})
				}
			} catch {
				// Skip unreadable dirs
			}
		}
	} catch {
		// Silent fail
	}

	return results
}

/**
 * Read prj.conf and detect enabled features for on-demand knowledge loading.
 */
async function detectProjectFeatures(
	cwd: string,
): Promise<{ hasBle: boolean; builds: Array<{ dir: string; boardTarget: string | null }> }> {
	const prjConfPath = path.join(cwd, "prj.conf")
	let hasBle = false

	try {
		if (await fileExistsAtPath(prjConfPath)) {
			const content = await fs.readFile(prjConfPath, "utf-8")
			// Shared anchored test with the welcome-screen probe (WorkspaceClassifier) so the two BLE detectors
			// agree — rejects commented / `=yes` / `CONFIG_BT_*` lines a bare substring would mis-match.
			hasBle = NRF_BLE_RE.test(content)
		}
	} catch {
		// Silent fail
	}

	// Scan for all build dirs (supports custom names: build_52840, build_central, etc.)
	const builds = await findAllBuildInfos(cwd)

	return { hasBle, builds }
}

/**
 * Map an nRF board target string to its board knowledge file (relPath), or null.
 * Mirrors getEspBoardKnowledgeFile so both platforms load boards via the TrackedLoad relPath path.
 */
function getBoardKnowledgeFile(boardTarget: string): string | null {
	const lower = boardTarget.toLowerCase()
	if (lower.includes("nrf52840")) {
		return "platforms/nrf/boards/nrf52840.md"
	}
	if (lower.includes("nrf52832") || lower.includes("nrf52dk")) {
		return "platforms/nrf/boards/nrf52832.md"
	}
	if (lower.includes("nrf5340")) {
		return "platforms/nrf/boards/nrf5340.md"
	}
	return null
}

/**
 * Map an ESP-IDF target string (CONFIG_IDF_TARGET) to its board knowledge file.
 * Returns null when there is no curated board file for the target yet.
 */
export function getEspBoardKnowledgeFile(target: string): string | null {
	const t = target.toLowerCase()
	if (t === "esp32s3" || t.includes("esp32-s3")) {
		return "platforms/esp/boards/esp32-s3.md"
	}
	if (t === "esp32c6" || t.includes("esp32-c6")) {
		return "platforms/esp/boards/esp32-c6.md"
	}
	if (t === "esp32c3" || t.includes("esp32-c3")) {
		return "platforms/esp/boards/esp32-c3.md"
	}
	if (t === "esp32") {
		return "platforms/esp/boards/esp32-devkitc-v4.md"
	}
	return null
}

/** A knowledge loader that also records every file it actually loads (for the
 *  no-double-load manifest). Returns "" for missing files. */
type TrackedLoad = (relPath: string) => Promise<string>

/**
 * An ESP-IDF project is identified by a `sdkconfig`, a `main/idf_component.yml`,
 * or a `CMakeLists.txt` that references ESP-IDF. Mirrors detectNrfPlatform's role
 * (the build variant is ESP, but we still gate the heavy platform load on the
 * workspace actually being an ESP-IDF project).
 */
export async function detectEspPlatform(cwd: string): Promise<boolean> {
	if (await fileExistsAtPath(path.join(cwd, "sdkconfig"))) {
		return true
	}
	if (await fileExistsAtPath(path.join(cwd, "sdkconfig.defaults"))) {
		return true
	}
	if (await fileExistsAtPath(path.join(cwd, "main", "idf_component.yml"))) {
		return true
	}
	const cmake = path.join(cwd, "CMakeLists.txt")
	if (await fileExistsAtPath(cmake)) {
		try {
			const c = await fs.readFile(cmake, "utf-8")
			if (/esp-idf|\$ENV\{IDF_PATH\}|idf_/i.test(c)) {
				return true
			}
		} catch {
			// fall through
		}
	}
	return false
}

/**
 * Scan build directories for ESP-IDF's `build/project_description.json` — the
 * post-build source of truth for what the project was actually built for
 * (the ESP analogue of nRF's `build_info.yml`). Returns the target per build dir.
 */
export async function findEspBuilds(cwd: string): Promise<Array<{ dir: string; target: string | null }>> {
	const results: Array<{ dir: string; target: string | null }> = []
	try {
		const entries = await fs.readdir(cwd, { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue
			}
			const pd = path.join(cwd, entry.name, "project_description.json")
			try {
				if (await fileExistsAtPath(pd)) {
					const json = JSON.parse(await fs.readFile(pd, "utf-8"))
					results.push({ dir: entry.name, target: typeof json.target === "string" ? json.target : null })
				}
			} catch {
				// Skip unreadable / invalid build descriptors
			}
		}
	} catch {
		// Silent fail
	}
	return results
}

/**
 * Detect ESP feature flags from project config, the nRF-mirroring way.
 *   - hasBle:   `CONFIG_BT_ENABLED=y` in sdkconfig (clean, same shape as CONFIG_BT)
 *   - hasWifi:  usage-based — esp_wifi is always *available*, so presence != use.
 *               Signal: sdkconfig explicitly enables it, OR the app component
 *               (`main/CMakeLists.txt` / `idf_component.yml`) references esp_wifi.
 *   - sdkTarget: `CONFIG_IDF_TARGET` (board fallback when no build exists yet)
 */
export async function detectEspFeatures(cwd: string): Promise<{ hasBle: boolean; hasWifi: boolean; sdkTarget: string | null }> {
	let hasBle = false
	let hasWifi = false
	let sdkTarget: string | null = null

	for (const name of ["sdkconfig", "sdkconfig.defaults"]) {
		const p = path.join(cwd, name)
		try {
			if (await fileExistsAtPath(p)) {
				const content = await fs.readFile(p, "utf-8")
				if (/^\s*CONFIG_BT_ENABLED\s*=\s*y/im.test(content)) {
					hasBle = true
				}
				if (/^\s*CONFIG_ESP_WIFI_ENABLED\s*=\s*y/im.test(content)) {
					hasWifi = true
				}
				if (!sdkTarget) {
					const m = content.match(/CONFIG_IDF_TARGET="?([\w-]+)"?/)
					if (m) {
						sdkTarget = m[1]
					}
				}
			}
		} catch {
			// Skip unreadable files
		}
	}

	// Wi-Fi usage signal from the app component manifest (esp_wifi in REQUIRES).
	if (!hasWifi) {
		for (const rel of ["main/CMakeLists.txt", "main/idf_component.yml"]) {
			const p = path.join(cwd, rel)
			try {
				if (await fileExistsAtPath(p)) {
					if (/esp[_-]wifi/i.test(await fs.readFile(p, "utf-8"))) {
						hasWifi = true
						break
					}
				}
			} catch {
				// Skip
			}
		}
	}

	return { hasBle, hasWifi, sdkTarget }
}

/**
 * Progressive ESP-IDF knowledge load. Loads the ESP base (index + rules + SDK),
 * then only the protocol guides the project's config/usage shows, then the board
 * file from the *build artifact* (project_description.json) — falling back to
 * sdkconfig's target. Live connected-chip detection is the workflow's job
 * (idf.py / esptool), not here. Mirrors the nRF static-vs-runtime split.
 */
async function getEspPlatformContext(cwd: string, load: TrackedLoad): Promise<string> {
	let ctx = "### Platform Detected: Espressif ESP32 / ESP-IDF\n\n"
	// Always: platform index + mandatory rules + SDK reference (esp-idf auto-selected).
	// All three rules under platforms/esp/rules/ are listed as MANDATORY/Always in
	// PLATFORM.md, so they MUST all be loaded here (mirrors the nRF rule set).
	ctx += (await load("platforms/esp/PLATFORM.md")) + "\n\n"
	ctx += (await load("platforms/esp/rules/esp-terminal.md")) + "\n\n"
	ctx += (await load("platforms/esp/rules/skill-loading.md")) + "\n\n"
	ctx += (await load("platforms/esp/rules/device-identity.md")) + "\n\n"
	ctx += (await load("platforms/esp/sdks/esp-idf/SDK.md")) + "\n\n"

	// Surface the IDF-version split so the agent can reconcile (rules/device-identity.md Step 3):
	// the active env's IDF vs the project's pinned IDF (dependencies.lock). The host bridge already
	// sources the pinned install automatically and asks when several are installed with no pin — this
	// block is so the agent SEES the versions and can confirm a mismatch with the user. Empty (e.g. in
	// snapshot tests, before detection runs) → nothing is added.
	const esp = getCachedEspEnvironment()
	if (esp.idfVersion || esp.projectIdfVersion) {
		const norm = (v?: string) => v?.replace(/^v/, "")
		const mismatch = esp.idfVersion && esp.projectIdfVersion && norm(esp.idfVersion) !== norm(esp.projectIdfVersion)
		ctx += "#### ESP-IDF Version\n"
		ctx += `- Active IDF env: ${esp.idfVersion ?? "unknown"}\n`
		ctx += `- Project pin (dependencies.lock): ${esp.projectIdfVersion ?? "none yet (components not resolved)"}\n`
		ctx += mismatch
			? "- ⚠ These differ — confirm which ESP-IDF to use before building (rules/device-identity.md Step 3). Never source export.sh by hand; the device tool sources the project's pinned install.\n\n"
			: "- The device tool sources the project's pinned install automatically; if several IDF versions are installed with no pin, it will ask which to use.\n\n"
	}

	// On-demand: protocols, loaded only when config/usage shows them (no hardcoding).
	const { hasBle, hasWifi, sdkTarget } = await detectEspFeatures(cwd)
	if (hasWifi) {
		ctx += "#### Protocol: Wi-Fi Detected\n\n"
		ctx += (await load("platforms/esp/sdks/esp-idf/protocols/WIFI.md")) + "\n\n"
	}
	if (hasBle) {
		ctx += "#### Protocol: BLE Detected\n\n"
		ctx += (await load("platforms/esp/sdks/esp-idf/protocols/BLE.md")) + "\n\n"
	}

	// Board: prefer the build artifact target(s); fall back to sdkconfig target.
	const builds = await findEspBuilds(cwd)
	const buildTargets = builds.map((b) => b.target).filter((t): t is string => !!t)
	const targets = buildTargets.length > 0 ? buildTargets : sdkTarget ? [sdkTarget] : []

	if (builds.length > 0) {
		const summary = builds
			.map((b) => `${b.dir}/ → target: ${b.target ?? "unknown"} (from project_description.json)`)
			.join(", ")
		ctx += `#### Existing Build Folders: ${summary}\n\n`
	}

	const loadedBoards = new Set<string>()
	for (const target of targets) {
		const boardFile = getEspBoardKnowledgeFile(target)
		if (boardFile && !loadedBoards.has(boardFile)) {
			loadedBoards.add(boardFile)
			ctx += (await load(boardFile)) + "\n\n"
		}
	}
	return ctx
}

/**
 * Progressive NCS / Zephyr knowledge load. Mirrors getEspPlatformContext: always
 * loads the platform index + mandatory rules + SDK reference, then feature- and
 * board-specific files on demand (BLE protocol, per-board constraints).
 */
async function getNrfPlatformContext(cwd: string, load: TrackedLoad): Promise<string> {
	let ctx = "### Platform Detected: nRF Connect SDK / Zephyr RTOS\n\n"

	// Always load: Platform index + platform rules.
	// All three rules under platforms/nrf/rules/ are listed as MANDATORY/Always
	// in PLATFORM.md, so they MUST all be loaded here.
	ctx += (await load("platforms/nrf/PLATFORM.md")) + "\n\n"
	ctx += (await load("platforms/nrf/rules/nrf-terminal.md")) + "\n\n"
	ctx += (await load("platforms/nrf/rules/skill-loading.md")) + "\n\n"
	ctx += (await load("platforms/nrf/rules/device-identity.md")) + "\n\n"

	// Always load: NCS SDK knowledge (project structure, Kconfig, build reference)
	ctx += (await load("platforms/nrf/sdks/ncs/SDK.md")) + "\n\n"

	// On-demand: Feature-based loading
	const { hasBle, builds } = await detectProjectFeatures(cwd)

	// Load BLE protocol knowledge if BLE is enabled
	if (hasBle) {
		ctx += "#### Protocol: BLE Detected\n\n"
		ctx += (await load("platforms/nrf/sdks/ncs/protocols/BLE.md")) + "\n\n"
	}

	// Load board-specific knowledge for all detected builds (deduplicated)
	if (builds.length > 0) {
		const loadedBoardFiles = new Set<string>()

		// Build summary for the agent
		const buildSummary = builds
			.map((b) => `${b.dir}/ → board: ${b.boardTarget ?? "unknown"} (from build_info.yml)`)
			.join(", ")
		ctx += `#### Existing Build Folders: ${buildSummary}\n\n`

		for (const build of builds) {
			if (!build.boardTarget) continue
			const boardFile = getBoardKnowledgeFile(build.boardTarget)
			if (boardFile && !loadedBoardFiles.has(boardFile)) {
				loadedBoardFiles.add(boardFile)
				ctx += (await load(boardFile)) + "\n\n"
			}
		}
	}

	// Workflows/Actions are NOT pre-loaded — listed in PLATFORM.md for on-demand use.
	return ctx
}

/**
 * Injected when the workspace contains BOTH an nRF and an ESP app. Relaxes the
 * single-platform scope gate in AGENT.md and tells the agent to confirm which app
 * a task targets before driving hardware.
 */
const MULTI_PLATFORM_NOTE = `> **MULTI-PLATFORM WORKSPACE.** This workspace contains BOTH an nRF Connect SDK / Zephyr app and an Espressif ESP-IDF app. The single-platform "Scope Gate" above is relaxed — BOTH nRF/NCS and ESP/ESP-IDF projects are in scope here. Before you build, flash, or debug, confirm with the user which app (nRF or ESP) the task targets, then use that platform's device tool (\`triggerNordicAction\` for nRF, \`triggerEspAction\` for ESP) and that platform's knowledge below.`

async function getIotContextTemplateText(context: SystemPromptContext): Promise<string> {
	const cwd = context.cwd || process.cwd()
	const kbPath = path.join(HostProvider.get().extensionFsPath, "iot-knowledge").replace(/\\/g, "/")

	// Platform is selected at RUNTIME from the workspace classification (not a build
	// flag): an ESP-IDF workspace gets the ESP identity/knowledge/tool, an nRF
	// workspace gets the nRF stack, a mixed workspace gets both, an empty one gets
	// the neutral default. See routePlatform().
	const summary = getCachedWorkspaceSummary()
	const route = routePlatform(summary)
	const exampleSkillPath =
		summary === "esp" ? "platforms/esp/workflows/debug-loop.md" : "platforms/nrf/workflows/log-analyzer.md"

	let iotContext = "## IoT & Embedded Context\n\n"

	iotContext += `> **SKILL LIBRARY LOCATION:** In this system, "Skills" refers collectively to both Workflows (multi-step tasks) and Actions (atomic operations).\n`
	iotContext += `> All agent skills and documentation files are physically located at \`${kbPath}\`.\n`
	iotContext += `> **CRITICAL RULE:** When using \`read_file\` to load a skill, you MUST use the absolute path by combining this directory with the skill file's relative path. For example: \`${kbPath}/${exampleSkillPath}\`\n\n`

	// Track every knowledge file we pre-load so we can tell the agent NOT to
	// re-read them (no-double-load / progressive disclosure — context optimization).
	const loaded: string[] = []
	const load: TrackedLoad = async (relPath) => {
		// Resolve by id via the KnowledgeResolver (bundled → cache → registry fetch) with a
		// direct-read fallback, so DOWNLOADED bits resolve exactly like bundled ones.
		const content = await loadKnowledge(deriveIdFromRel(relPath), relPath)
		if (content) {
			loaded.push(relPath)
		}
		return content
	}

	// 1. Global Base: the single platform-neutral identity (AGENT.md covers nRF + ESP,
	//    routing by the detected platform) + universal rules.
	iotContext += (await load("AGENT.md")) + "\n\n"
	if (route.multiPlatform) {
		iotContext += MULTI_PLATFORM_NOTE + "\n\n"
	}
	iotContext += (await load("rules/core.md")) + "\n\n"
	iotContext += (await load("rules/tool-routing.md")) + "\n\n"

	// 2. Platform knowledge — load each platform the classification allows AND the
	//    cwd confirms as a real project. A single-platform workspace loads exactly
	//    one; a mixed (both) workspace loads both; an empty (none) workspace loads
	//    neither. The identity + tool gates above already reflect the classification,
	//    so even if the cwd detect is inconclusive the agent still has the right
	//    persona and device tool — only the heavy knowledge is gated on the cwd.
	let isPlatformDetected = false

	if (route.loadNrf && (await detectNrfPlatform(cwd))) {
		isPlatformDetected = true
		iotContext += await getNrfPlatformContext(cwd, load)
	}

	if (route.loadEsp && (await detectEspPlatform(cwd))) {
		isPlatformDetected = true
		iotContext += await getEspPlatformContext(cwd, load)
	}

	// Future platforms (Mbed, Zephyr-on-other-vendors, etc.) can be added here.

	if (!isPlatformDetected) {
		iotContext += "No specific IoT platform detected in the workspace. Using universal embedded rules.\n"
	}

	// No-double-load manifest: list exactly what is already in context so the agent
	// never wastes tokens re-reading these. Use read_file only for a skill file NOT
	// in this list (a workflow/action a rule points you to).
	if (loaded.length > 0) {
		iotContext += "\n### Knowledge Already Loaded — do NOT read these again\n\n"
		iotContext +=
			"The files below are ALREADY included in your context above. Do NOT call `read_file` on any of them — it only wastes context. Use `read_file` only for a skill file that is NOT in this list:\n\n"
		for (const f of loaded) {
			iotContext += `- ${f}\n`
		}
		iotContext += "\n"
	}

	// 5. Load Project Memory
	// TODO: Enable this feature after core stability is verified
	// const memoryManager = new IotProjectMemoryManager(cwd)
	// await memoryManager.initialize()
	// iotContext += await memoryManager.getMemoryContext()

	return iotContext
}

export async function getIotContextSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template =
		variant.componentOverrides?.[SystemPromptSection.IOT_CONTEXT]?.template || (await getIotContextTemplateText(context))
	return new TemplateEngine().resolve(template, context, {})
}
