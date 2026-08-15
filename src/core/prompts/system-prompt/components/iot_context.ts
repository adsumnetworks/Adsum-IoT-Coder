import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { getCachedEspEnvironment } from "@/services/esp/EspEnvironmentDetector"
import { bitSdkRequirement, deriveIdFromRel, loadBit } from "@/services/knowledge/KnowledgeResolver"
import { stripFrontmatter } from "@/services/knowledge/kbit/frontmatter"
import { ncsGateNotice } from "@/services/knowledge/kbit/ncsGate"
import { getCachedNrfEnvironment } from "@/services/nrf/EnvironmentDetector"
import { routePlatform } from "@/services/platform/platformRouting"
import { getCachedWorkspaceSummary, NRF_BLE_RE } from "@/services/platform/WorkspaceClassifier"
import { fileExistsAtPath } from "@/utils/fs"
import { shouldInjectMap } from "../../../memory/workspace/mapGate"
import { migrateLegacyMemory } from "../../../memory/workspace/migrate"
import { resolveAdsumPaths } from "../../../memory/workspace/paths"
import { readMapMd, readProjectMd } from "../../../memory/workspace/store"
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
export function getBoardKnowledgeFile(boardTarget: string): string | null {
	// Separators are stripped so ONE router serves every shape this string arrives in: a Zephyr board
	// target ("xiao_nrf54lm20a/nrf54lm20a/cpuapp"), an overlay filename ("xiao-nrf54lm20a.overlay"),
	// and a USB product string ("Seeed Studio XIAO nRF54LM20A CMSIS-DAP"). The last one is why this
	// exists: a spaced product string matched none of the underscore/hyphen tests, so a connected XIAO
	// routed to the DK bit — the same silicon on a different board, with different pins.
	const lower = boardTarget.toLowerCase().replace(/[\s_-]+/g, "")

	// ORDER MATTERS — these are substring tests over strings that nest inside one another:
	//   "xiaonrf54lm20a/nrf54lm20a/cpuapp" contains "nrf54lm20a", so the XIAO must be matched BEFORE the
	//   nRF54LM20 DK or a XIAO project silently loads DK knowledge (wrong pins, wrong flashing route).
	//   "nrf54lm20" also contains "nrf54l", so any broad "nrf54l" test must come last.
	// Most specific first, always.

	// nRF54 — Seeed XIAO module. Not a Nordic DK; needs an out-of-tree board definition.
	if (lower.includes("xiaonrf54lm20")) {
		return "platforms/nrf/boards/xiao-nrf54lm20a.md"
	}
	// nRF54LM20 DK. Covers both SoC variants: the DK carries B silicon and emulates A.
	if (lower.includes("nrf54lm20")) {
		return "platforms/nrf/boards/nrf54lm20dk.md"
	}
	// nRF54L15 DK. Also serves the nRF54L10 and nRF54L05 emulation targets, which only exist ON this DK.
	if (lower.includes("nrf54l15") || lower.includes("nrf54l10") || lower.includes("nrf54l05")) {
		return "platforms/nrf/boards/nrf54l15dk.md"
	}

	// nRF53 / nRF52.
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

/** A board the workspace points at, and the evidence that says so. */
interface BoardSignal {
	/** Whatever names the board: a Zephyr target, an overlay filename, or a USB product string. */
	target: string
	/** Shown to the agent so it can weigh the claim instead of treating a guess as a fact. */
	origin: string
}

/**
 * Board targets a project points at BEFORE it has ever been built.
 *
 * THE BUG THIS FIXES (2026-08-14): board knowledge was loaded only from `build_info.yml`, which does
 * not exist until a successful build. So on a fresh project — exactly when the agent is choosing a
 * board target and setting up a build — no board bit was loaded at all, and the model answered from
 * its training instead. With a XIAO nRF54LM20A on the desk it kept asserting an nRF54L15 DK, because
 * that is the only nRF54 board its training knows. The knowledge existed; nothing ever asked for it.
 *
 * Both signals here are things a developer writes down before the first build: a board-specific
 * overlay under `boards/`, or a BOARD pin in CMakeLists.txt.
 */
export async function detectPinnedBoards(cwd: string): Promise<BoardSignal[]> {
	const out: BoardSignal[] = []

	// boards/<board>.overlay|.conf — the Zephyr convention for per-board configuration.
	try {
		for (const entry of await fs.readdir(path.join(cwd, "boards"), { withFileTypes: true })) {
			if (entry.isFile() && /\.(overlay|conf)$/i.test(entry.name)) {
				out.push({ target: entry.name.replace(/\.(overlay|conf)$/i, ""), origin: `boards/${entry.name}` })
			}
		}
	} catch {
		// No boards/ directory — normal for a single-board app.
	}

	// set(BOARD x) / -DBOARD=x / BOARD ?= x in the app's CMakeLists.txt.
	try {
		const cmake = await fs.readFile(path.join(cwd, "CMakeLists.txt"), "utf-8")
		for (const m of cmake.matchAll(/(?:set\s*\(\s*BOARD\s+|-DBOARD=|BOARD\s*\?=\s*)["']?([\w./-]+)/gi)) {
			out.push({ target: m[1], origin: "CMakeLists.txt (BOARD)" })
		}
	} catch {
		// No CMakeLists.txt, or unreadable.
	}

	return out
}

/**
 * Boards physically connected right now, as the nRF probe sees them.
 *
 * Weakest evidence of the three and deliberately last: a board on the bench is not necessarily the
 * board this project targets. It is still far better than silence — it is the difference between
 * "an nRF54LM20A is plugged in" and the model guessing which nRF54 exists.
 */
function connectedBoardSignals(): BoardSignal[] {
	const out: BoardSignal[] = []
	for (const b of getCachedNrfEnvironment().boards ?? []) {
		// The product string is the more specific of the two — it distinguishes a XIAO from the DK
		// carrying the same chip. Fall back to the chip name when there is no product string.
		const target = b.productName || b.deviceName || b.deviceFamily
		if (target) {
			out.push({ target, origin: `connected board ${b.serialNumber}` })
		}
	}
	return out
}

/**
 * Which platforms the HARDWARE on the bench is evidence for, used only when the workspace itself
 * names no platform. Pure, so the rule is testable without the detector caches.
 *
 * Kept deliberately narrow: this decides whether to load a platform's knowledge for a workspace that
 * has none of its own (the prototype case). In a workspace that IS classified, an unrelated board
 * plugged into the same machine must not drag in a second platform and break the scope gate.
 */
export function platformsFromConnectedHardware(
	nrfBoardCount: number,
	espDeviceCount: number,
): {
	nrf: boolean
	esp: boolean
} {
	return { nrf: nrfBoardCount > 0, esp: espDeviceCount > 0 }
}

/**
 * Advisory when a board bit needs a newer nRF Connect SDK than this machine has.
 *
 * Advisory, never blocking: Nordic's support matrix has three levels (unsupported / experimental /
 * supported), and a developer may legitimately be ahead of what a bit was written against. The bit is
 * always loaded — this only adds the sentence that saves a wasted build cycle.
 */
async function boardSdkNotice(boardRelPath: string): Promise<string | null> {
	try {
		const bitId = deriveIdFromRel(boardRelPath)
		const req = await bitSdkRequirement(bitId)
		if (!req?.minNcs) {
			return null
		}
		const nrf = getCachedNrfEnvironment()
		return ncsGateNotice({
			bitId,
			title: req.title,
			minNcs: req.minNcs,
			installed: nrf.installedSdkVersions ?? [],
			projectPin: nrf.projectSdk?.version,
		})
	} catch {
		// Advisory only — it must never be able to break prompt assembly.
		return null
	}
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

	// Connected devices the host ALREADY identified, in the background, before the task started.
	//
	// THE BUG THIS FIXES (2026-08-13): the agent ran `esptool.py -p COMx flash_id` in the developer's
	// terminal to work out which chip was attached — noisy, slow, and it resets the board. The host had
	// already run exactly that probe silently and cached the answer per USB serial; nothing ever told
	// the agent, and the device tool's own instructions still pointed at `flash_id`. Stating the answer
	// here is what makes the "don't probe" rule in the tool description followable.
	const espDevices = getCachedEspEnvironment().espDevices ?? []
	if (espDevices.length > 0) {
		ctx += "#### Connected ESP Devices (already identified — do NOT re-probe)\n"
		for (const d of espDevices) {
			const bits = [
				d.chip ? `chip ${d.chip}` : "chip not yet resolved",
				d.chipRevision ? `revision ${d.chipRevision}` : undefined,
				d.mac ? `MAC ${d.mac}` : undefined,
			].filter(Boolean)
			ctx += `- \`${d.port}\` — ${bits.join(", ")}\n`
		}
		ctx +=
			"\nThe host probed these in the background and cached the result per board. Do NOT run " +
			"`esptool.py flash_id` (or any other identification command) to rediscover what is listed above: " +
			"it resets the board, takes over the developer's terminal, and tells you what you already know. " +
			"Pass the `port` shown here to build/flash/monitor.\n\n"
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

	// Board: prefer the build artifact target(s), then the sdkconfig target, then — when the workspace
	// says nothing at all (a prototype with no project yet) — the chip actually plugged in. Mirrors the
	// nRF side: before the first build there is no artifact to read, and that is exactly when the agent
	// is choosing a target and most needs the board's constraints.
	const builds = await findEspBuilds(cwd)
	const buildTargets = builds.map((b) => b.target).filter((t): t is string => !!t)
	const connectedChips = (getCachedEspEnvironment().espDevices ?? []).map((d) => d.chip).filter((c): c is string => !!c)
	const targets =
		buildTargets.length > 0 ? buildTargets : sdkTarget ? [sdkTarget] : connectedChips.length > 0 ? connectedChips : []

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

	// Surface the NCS-version picture so the agent SEES which toolchain the device tool will use and
	// can disambiguate when needed (rules/nrf-terminal.md). The host bridge auto-resolves the version
	// (project build pin → single install → ask once) and sources the toolchain in the background; this
	// block just makes the state visible. Empty (e.g. snapshot tests, before detection) → nothing added.
	const nrf = getCachedNrfEnvironment()
	const installed = nrf.installedSdkVersions ?? []
	if (nrf.projectSdk?.version || installed.length > 0) {
		const norm = (v?: string) => v?.replace(/^v/, "")
		const pin = nrf.projectSdk?.version
		const pinInstalled = pin && installed.some((v) => norm(v) === norm(pin))
		ctx += "#### nRF Connect SDK Version\n"
		ctx += `- Installed NCS toolchains: ${installed.length > 0 ? installed.join(", ") : "none detected"}\n`
		ctx += `- Project pin (${nrf.projectSdk?.source ?? "none"}): ${pin ?? "none yet (not built)"}\n`
		if (pin && installed.length > 0 && !pinInstalled) {
			ctx += `- ⚠ The project pins ${pin} but it is not among the installed toolchains — confirm with the user which NCS to use.\n`
		}
		ctx +=
			installed.length > 1 && !pin
				? "- Several NCS versions are installed and this project has no build yet. The device tool will ask once which to use, then remember it; pass `ncs_version` when you re-run.\n\n"
				: "- The device tool resolves the NCS version and sources the toolchain automatically (in its own terminal). Never open the nRF terminal or source the env by hand.\n\n"
	}

	// On-demand: Feature-based loading
	const { hasBle, builds } = await detectProjectFeatures(cwd)

	// Load BLE protocol knowledge if BLE is enabled
	if (hasBle) {
		ctx += "#### Protocol: BLE Detected\n\n"
		ctx += (await load("platforms/nrf/sdks/ncs/protocols/BLE.md")) + "\n\n"
	}

	if (builds.length > 0) {
		const buildSummary = builds
			.map((b) => `${b.dir}/ → board: ${b.boardTarget ?? "unknown"} (from build_info.yml)`)
			.join(", ")
		ctx += `#### Existing Build Folders: ${buildSummary}\n\n`
	}

	// Board knowledge, from the strongest available evidence.
	//
	// Ordered by how much the signal can be trusted: what was actually built > what the project pins
	// in source > what happens to be plugged in. Everything is loaded (a bit is small and being wrong
	// about which board is on the bench is cheap), but the ORDER decides which bit wins the dedupe,
	// and the provenance line tells the agent how much weight the claim carries.
	const boardSignals: BoardSignal[] = [
		...builds
			.filter((b) => b.boardTarget)
			.map((b) => ({ target: b.boardTarget as string, origin: `${b.dir}/build_info.yml` })),
		...(await detectPinnedBoards(cwd)),
		...connectedBoardSignals(),
	]

	if (boardSignals.length > 0) {
		const loadedBoardFiles = new Set<string>()
		const evidence: string[] = []
		for (const signal of boardSignals) {
			const boardFile = getBoardKnowledgeFile(signal.target)
			evidence.push(`- \`${signal.target}\` — from ${signal.origin}${boardFile ? "" : " (no board knowledge yet)"}`)
			if (!boardFile || loadedBoardFiles.has(boardFile)) {
				continue
			}
			loadedBoardFiles.add(boardFile)
			ctx += (await load(boardFile)) + "\n\n"
			// A board bit can be correct knowledge and still describe a target the installed SDK does
			// not have. Say so here, beside the knowledge, rather than letting a build failure teach it.
			const sdkNotice = await boardSdkNotice(boardFile)
			if (sdkNotice) {
				ctx += sdkNotice + "\n\n"
			}
		}
		// Stated AFTER the bits so the agent reads the evidence with the knowledge in hand, and so a
		// board with no bit yet is still visible rather than silently absent.
		ctx += `#### Board Evidence\n${evidence.join("\n")}\n\n`
		ctx +=
			"Board knowledge above comes from these signals. A `build_info.yml` target is what was actually " +
			"built; a source pin is what the project intends; a connected board is only what is on the bench " +
			"right now and may not be this project's target. Do NOT assert a board the evidence does not name — " +
			"if none is listed, ask the developer or read the hardware, never assume the most common part.\n\n"
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

/**
 * Assemble the whole IoT knowledge block for a workspace.
 *
 * `cwd` is the ONLY input taken from the request — everything else comes from the filesystem
 * and the process-wide detector caches. That is what makes the memo below sound: two requests
 * with the same cwd and unchanged inputs must produce the same bytes, whatever variant or
 * model is asking. Keep it that way; if this ever needs another field off
 * `SystemPromptContext`, that field must join the fingerprint too.
 */
async function buildIotContextTemplateText(cwd: string): Promise<string> {
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
	// Shared skill-loading framework (Scope Gate / Command Gate / MANDATORY SKILL LOAD) — factored
	// out of the two per-platform copies (−3.1K chars each); the platform stubs reference it.
	iotContext += (await load("rules/skill-loading.md")) + "\n\n"

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

	// Nothing in the workspace names a platform — so fall back to what is PHYSICALLY PLUGGED IN.
	//
	// THE FAILURE THIS FIXES (2026-08-13 bench session): a prototype was started with no folder open,
	// so cwd was the Desktop, both detects returned false, and the agent got NO platform knowledge for
	// the entire session — no SDK reference, no board bits. It still had the device tools (they are
	// advertised for an empty workspace precisely because prototyping starts before any project
	// exists), used them, and read back "Seeed Studio XIAO nRF54LM20A CMSIS-DAP" — then designed the
	// whole system from base-model training, insisting on an nRF54L15 DK the developer does not own.
	// Advertising a device tool while withholding the knowledge to interpret what it returns is the
	// worst of both worlds.
	//
	// Scoped deliberately to the case where the workspace claims NO platform of its own: in a
	// classified workspace an unrelated board on the bench must not drag in a second platform's
	// knowledge and break the scope gate.
	if (!isPlatformDetected) {
		const nrfConnected = connectedBoardSignals()
		const espConnected = getCachedEspEnvironment().espDevices ?? []
		const fromHardware = platformsFromConnectedHardware(nrfConnected.length, espConnected.length)

		if (fromHardware.nrf) {
			isPlatformDetected = true
			iotContext +=
				"> **No project is open, but Nordic hardware is connected.** The knowledge below is loaded on the " +
				"strength of what is plugged in, not a project. Confirm the target board with the developer before " +
				"scaffolding.\n\n"
			iotContext += await getNrfPlatformContext(cwd, load)
		}
		if (fromHardware.esp) {
			isPlatformDetected = true
			iotContext +=
				"> **No project is open, but Espressif hardware is connected.** The knowledge below is loaded on the " +
				"strength of what is plugged in, not a project. Confirm the target chip with the developer before " +
				"scaffolding.\n\n"
			iotContext += await getEspPlatformContext(cwd, load)
		}
	}

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

	// 5. Project memory — TIER A ONLY.
	//
	//    This block is the cached prefix of every request. Whatever goes in here must change ONLY
	//    when the workspace itself changes, because rewriting it forces the provider to re-process
	//    ~46K tokens. So only the STABLE, host-written half lands here: goal, apps, detected
	//    hardware, toolchain, notes index, and (when the task-start gate says so) the file map.
	//
	//    The volatile half — open defects, current focus, last error — is Tier B: rendered by
	//    host code onto the LAST USER MESSAGE each turn (see renderTailBlock), where mutation is
	//    free and where the model attends best. Never move Tier B content into this function.
	//
	//    Best-effort throughout: memory is an enhancement, so any storage failure must degrade to
	//    "no memory" rather than taking down the system prompt.
	try {
		iotContext += buildProjectMemorySection(cwd)
	} catch (e) {
		console.error("Failed to load workspace project memory:", e)
	}

	return iotContext
}

/**
 * Render the Tier A memory block: PROJECT.md, plus MAP.md when the map gate is on.
 *
 * Both are read straight off disk — host code is what keeps them current — so this stays a
 * cheap, synchronous read on an already-memoized path.
 */
function buildProjectMemorySection(cwd: string): string {
	// One-shot: import any pre-.adsum legacy memory (globalStorage/iot-memory/<hash>/) into
	// .adsum/notes/ the first time this workspace is seen. The sentinel file short-circuits
	// every call after the first, so this is cheap on the hot path.
	migrateLegacyMemory(cwd)
	const projectMd = readProjectMd(cwd)
	const mapMd = shouldInjectMap(cwd) ? readMapMd(cwd) : ""
	if (!projectMd && !mapMd) {
		return ""
	}
	const paths = resolveAdsumPaths(cwd)
	let out = "\n### 🧠 PROJECT MEMORY — persistent across sessions\n\n"
	out +=
		"This is what is already known about this project. It survives context compaction and new tasks. " +
		"**Trust it over re-deriving:** do not re-run device discovery, SDK version probes, or directory " +
		"listings for anything answered below. If a fact is marked stale, re-verify just that fact.\n\n"
	out +=
		"ASSUME INTERRUPTION: this session can be compacted or ended at any moment. Record decisions and " +
		"findings as you make them, not at the end.\n\n"
	if (projectMd) {
		out += `${projectMd.trim()}\n\n`
	}
	if (mapMd) {
		out += `${mapMd.trim()}\n\n`
	}
	out += `To record something durable, use update_project_memory. Files: ${paths.projectMd} (project facts), ${paths.statusJson} (goals + defects), ${paths.notesDir} (topic notes).\n\n`
	return out
}

// ───────────────────────────────────────────────────────────────────────────────
// Assembly memo
//
// The block built above is the single largest slice of the system prompt (measured at
// 37–46K tokens), and it was rebuilt from scratch on EVERY request: re-running platform
// detection (directory scans, prj.conf / sdkconfig / build_info.yml reads) and re-reading
// a dozen knowledge files, to produce — in the overwhelming majority of turns — a
// byte-identical string.
//
// So we memoize per workspace, keyed on a fingerprint of the inputs the assembly actually
// reads. The fingerprint is deliberately cheap (stats, not reads) and deliberately
// *complete*: anything the builder consults must appear in it, or an edit to that input
// would be silently ignored for the rest of the session. It covers
//   - the workspace (cwd) and the knowledge root (extensionFsPath),
//   - the cached workspace classification + the cached nRF / ESP environment probes,
//   - mtime+size of every cwd-level detector input (prj.conf, CMakeLists.txt, sdkconfig,
//     sdkconfig.defaults, main/idf_component.yml, main/CMakeLists.txt),
//   - mtime+size of every build descriptor found one level down (build_info.yml,
//     project_description.json) — these carry the board/target that selects board files,
//   - mtime+size of the three project-memory files, which the agent rewrites mid-task.
//
// Fail-open: if the fingerprint cannot be computed the memo is bypassed entirely and the
// block is rebuilt, so a stat failure can only cost time, never correctness.
// ───────────────────────────────────────────────────────────────────────────────

interface IotContextMemoEntry {
	fingerprint: string
	text: string
}

/** cwd → last assembled block. Bounded so a long-lived host that opens many workspaces
 *  cannot accumulate 40K-token strings without limit. */
const iotContextMemo = new Map<string, IotContextMemoEntry>()
const IOT_CONTEXT_MEMO_MAX_ENTRIES = 8

/** cwd-level files whose content feeds platform detection / feature flags. */
const FINGERPRINT_FILES = [
	"prj.conf",
	"CMakeLists.txt",
	"sdkconfig",
	"sdkconfig.defaults",
	path.join("main", "idf_component.yml"),
	path.join("main", "CMakeLists.txt"),
]

/** Build descriptors scanned one level below cwd (nRF then ESP). */
const FINGERPRINT_BUILD_DESCRIPTORS = ["build_info.yml", "project_description.json"]

/** `mtime:size` for a path, or "-" when it does not exist / cannot be stat'd. */
async function statSignature(filePath: string): Promise<string> {
	try {
		const s = await fs.stat(filePath)
		return `${Math.round(s.mtimeMs)}:${s.size}`
	} catch {
		return "-"
	}
}

/** Cheap fingerprint of every input `buildIotContextTemplateText` reads, or null if it
 *  could not be computed (caller then skips the cache and rebuilds). */
async function computeIotContextFingerprint(cwd: string): Promise<string | null> {
	try {
		const parts: string[] = [`cwd=${cwd}`, `ext=${HostProvider.get().extensionFsPath}`, `ws=${getCachedWorkspaceSummary()}`]

		// Runtime env probes are read straight into the block (SDK/IDF version notes), so a
		// re-probe that changes them must invalidate.
		const nrf = getCachedNrfEnvironment()
		parts.push(
			`nrf=${(nrf.installedSdkVersions ?? []).join("|")}@${nrf.projectSdk?.version ?? ""}#${nrf.projectSdk?.source ?? ""}`,
		)
		// Connected boards now select board knowledge (connectedBoardSignals), so plugging a board in
		// must invalidate. Identity only — never `lastSeenAt`, or a re-probe would rebuild every turn.
		parts.push(
			`boards=${(nrf.boards ?? [])
				.map((b) => `${b.serialNumber}:${b.productName ?? b.deviceName ?? b.deviceFamily ?? ""}`)
				.sort()
				.join("|")}`,
		)

		// boards/<board>.overlay|.conf names pin a board before any build exists. Only the NAMES matter,
		// so list them rather than stat'ing contents.
		try {
			const overlays = (await fs.readdir(path.join(cwd, "boards"), { withFileTypes: true }))
				.filter((e) => e.isFile() && /\.(overlay|conf)$/i.test(e.name))
				.map((e) => e.name)
				.sort()
			parts.push(`boardsdir=${overlays.join(",")}`)
		} catch {
			parts.push("boardsdir=-")
		}
		const esp = getCachedEspEnvironment()
		parts.push(`esp=${esp.idfVersion ?? ""}#${esp.projectIdfVersion ?? ""}`)
		// Connected ESP devices can now switch the whole ESP platform block on (hardware fallback for a
		// workspace with no project), so their presence has to invalidate too.
		parts.push(
			`espdev=${(esp.espDevices ?? [])
				.map((d) => `${d.port ?? ""}:${d.chip ?? ""}`)
				.sort()
				.join("|")}`,
		)

		for (const rel of FINGERPRINT_FILES) {
			parts.push(`${rel}=${await statSignature(path.join(cwd, rel))}`)
		}

		// Build folders can have any name (build, build_52840, build_central…), so mirror the
		// detectors' own readdir rather than guessing names.
		const buildSigs: string[] = []
		try {
			const entries = await fs.readdir(cwd, { withFileTypes: true })
			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue
				}
				for (const name of FINGERPRINT_BUILD_DESCRIPTORS) {
					const sig = await statSignature(path.join(cwd, entry.name, name))
					if (sig !== "-") {
						buildSigs.push(`${entry.name}/${name}=${sig}`)
					}
				}
			}
			buildSigs.sort()
			parts.push(`builds=${buildSigs.join(",")}`)
		} catch {
			// cwd unreadable — the detectors will see the same thing; record it as a state.
			parts.push("builds=unreadable")
		}

		// Tier A memory only. PROJECT.md and MAP.md are host-written and change only when the
		// workspace changes, so including them here is correct: an invalidation coincides with a
		// real change the prompt must reflect.
		//
		// status.json / local/session.json are deliberately ABSENT. They are Tier B — rendered
		// onto the last user message every turn — and adding them here would reintroduce exactly
		// the problem this split exists to remove: a defect note rewriting the cached prefix.
		const adsum = resolveAdsumPaths(cwd)
		parts.push(`adsum:PROJECT.md=${await statSignature(adsum.projectMd)}`)
		parts.push(`adsum:MAP.md=${await statSignature(adsum.mapMd)}`)

		return parts.join("\n")
	} catch {
		return null
	}
}

/** Drop every memoized IoT-context block. For tests, and for any host-level event
 *  (knowledge re-install, workspace re-classification) that should force a rebuild. */
export function clearIotContextCache(): void {
	iotContextMemo.clear()
}

async function getIotContextTemplateText(context: SystemPromptContext): Promise<string> {
	const cwd = context.cwd || process.cwd()
	const fingerprint = await computeIotContextFingerprint(cwd)

	if (fingerprint !== null) {
		const cached = iotContextMemo.get(cwd)
		if (cached && cached.fingerprint === fingerprint) {
			return cached.text
		}
	}

	const text = await buildIotContextTemplateText(cwd)

	if (fingerprint !== null) {
		// Re-fingerprint AFTER the build. The build has one legitimate side effect on its own
		// inputs — IotProjectMemoryManager.initialize() creates the three memory files the first
		// time a workspace is seen — and storing the pre-build value would invalidate the entry
		// we just wrote and force one wasted rebuild on the very next turn.
		const settled = (await computeIotContextFingerprint(cwd)) ?? fingerprint
		if (!iotContextMemo.has(cwd) && iotContextMemo.size >= IOT_CONTEXT_MEMO_MAX_ENTRIES) {
			const oldest = iotContextMemo.keys().next().value
			if (oldest !== undefined) {
				iotContextMemo.delete(oldest)
			}
		}
		iotContextMemo.set(cwd, { fingerprint: settled, text })
	}

	return text
}

export async function getIotContextSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template =
		variant.componentOverrides?.[SystemPromptSection.IOT_CONTEXT]?.template || (await getIotContextTemplateText(context))
	return new TemplateEngine().resolve(template, context, {})
}
