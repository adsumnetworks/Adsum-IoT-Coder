import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { stripFrontmatter } from "@/services/knowledge/kbit/frontmatter"
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
			hasBle = content.includes("CONFIG_BT=y")
		}
	} catch {
		// Silent fail
	}

	// Scan for all build dirs (supports custom names: build_52840, build_central, etc.)
	const builds = await findAllBuildInfos(cwd)

	return { hasBle, builds }
}

/**
 * Map a board target string to the corresponding board knowledge file.
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

async function getIotContextTemplateText(context: SystemPromptContext): Promise<string> {
	const cwd = context.cwd || process.cwd()
	const kbPath = path.join(HostProvider.get().extensionFsPath, "iot-knowledge").replace(/\\/g, "/")

	let iotContext = "## IoT & Embedded Context\n\n"

	iotContext += `> **SKILL LIBRARY LOCATION:** In this system, "Skills" refers collectively to both Workflows (multi-step tasks) and Actions (atomic operations).\n`
	iotContext += `> All agent skills and documentation files are physically located at \`${kbPath}\`.\n`
	iotContext += `> **CRITICAL RULE:** When using \`read_file\` to load a skill, you MUST use the absolute path by combining this directory with the skill file's relative path. For example: \`${kbPath}/platforms/nrf/workflows/log-analyzer.md\`\n\n`

	// 1. Always load Global Base: Identity + Universal Rules
	iotContext += (await readKnowledgeFile("AGENT.md")) + "\n\n"
	iotContext += (await readKnowledgeFile("rules/core.md")) + "\n\n"
	iotContext += (await readKnowledgeFile("rules/tool-routing.md")) + "\n\n"

	// 2. Progressive Platform Detection
	let isPlatformDetected = false

	// Detect Zephyr / nRF Connect SDK
	if (await detectNrfPlatform(cwd)) {
		isPlatformDetected = true
		iotContext += "### Platform Detected: nRF Connect SDK / Zephyr RTOS\n\n"

		// Always load: Platform index + platform rules.
		// All three rules under platforms/nrf/rules/ are listed as MANDATORY/Always
		// in PLATFORM.md, so they MUST all be loaded here.
		iotContext += (await readKnowledgeFile("platforms/nrf/PLATFORM.md")) + "\n\n"
		iotContext += (await readKnowledgeFile("platforms/nrf/rules/nrf-terminal.md")) + "\n\n"
		iotContext += (await readKnowledgeFile("platforms/nrf/rules/skill-loading.md")) + "\n\n"
		iotContext += (await readKnowledgeFile("platforms/nrf/rules/device-identity.md")) + "\n\n"

		// Always load: NCS SDK knowledge (project structure, Kconfig, build reference)
		iotContext += (await readKnowledgeFile("platforms/nrf/sdks/ncs/SDK.md")) + "\n\n"

		// 3. On-demand: Feature-based loading
		const { hasBle, builds } = await detectProjectFeatures(cwd)

		// Load BLE protocol knowledge if BLE is enabled
		if (hasBle) {
			iotContext += "#### Protocol: BLE Detected\n\n"
			iotContext += (await readKnowledgeFile("platforms/nrf/sdks/ncs/protocols/BLE.md")) + "\n\n"
		}

		// Load board-specific knowledge for all detected builds (deduplicated)
		if (builds.length > 0) {
			const loadedBoardFiles = new Set<string>()

			// Build summary for the agent
			const buildSummary = builds
				.map((b) => `${b.dir}/ → board: ${b.boardTarget ?? "unknown"} (from build_info.yml)`)
				.join(", ")
			iotContext += `#### Existing Build Folders: ${buildSummary}\n\n`

			for (const build of builds) {
				if (!build.boardTarget) continue
				const boardFile = getBoardKnowledgeFile(build.boardTarget)
				if (boardFile && !loadedBoardFiles.has(boardFile)) {
					loadedBoardFiles.add(boardFile)
					iotContext += (await readKnowledgeFile(boardFile)) + "\n\n"
				}
			}
		}

		// 4. Workflows are NOT pre-loaded - listed in PLATFORM.md for on-demand use.
		//    The agent reads the relevant workflow file when the task matches.
		//    Actions are also not pre-loaded - agent reads them when executing a workflow step.
	}

	// Future platforms (ESP-IDF, Mbed, etc.) can be added here...

	if (!isPlatformDetected) {
		iotContext += "No specific IoT platform detected in the workspace. Using universal embedded rules.\n"
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
