import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { fileExistsAtPath } from "@/utils/fs"
import { IotProjectMemoryManager } from "../../../memory/IotProjectMemoryManager"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

async function readKnowledgeFile(relativePath: string): Promise<string> {
	try {
		const extPath = HostProvider.get().extensionFsPath
		const fullPath = path.join(extPath, "iot-knowledge", relativePath)
		if (await fileExistsAtPath(fullPath)) {
			return await fs.readFile(fullPath, "utf-8")
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
 *   - CMakeLists.txt       (with `find_package(Zephyr ...)`)
 *   - src/main.c           (application entry point)
 *   - Optional: boards/, sample.yaml, *.overlay, *.dts
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

async function getIotContextTemplateText(context: SystemPromptContext): Promise<string> {
	const cwd = context.cwd || process.cwd()
	let iotContext = "## IoT & Embedded Context\n\n"

	// 1. Always load Universal Core Rules & Routing
	iotContext += (await readKnowledgeFile("AGENT.md")) + "\n\n"
	iotContext += (await readKnowledgeFile("rules/core.md")) + "\n\n"
	iotContext += (await readKnowledgeFile("rules/tool-routing.md")) + "\n\n"

	// 2. Progressive Platform Detection
	let isPlatformDetected = false

	// Detect Zephyr / nRF Connect SDK
	if (await detectNrfPlatform(cwd)) {
		isPlatformDetected = true
		iotContext += "### Platform Detected: nRF Connect SDK / Zephyr RTOS\n\n"
		iotContext += (await readKnowledgeFile("platforms/nrf/PLATFORM.md")) + "\n\n"

		// Load Workflows
		iotContext += "#### Workflows\n\n"
		iotContext += (await readKnowledgeFile("platforms/nrf/workflows/debug-loop.md")) + "\n\n"
		iotContext += (await readKnowledgeFile("platforms/nrf/workflows/log-analyzer.md")) + "\n\n"
		iotContext += (await readKnowledgeFile("platforms/nrf/workflows/log-generator.md")) + "\n\n"
	}

	// Future platforms (ESP-IDF, Mbed, etc.) can be added here...

	if (!isPlatformDetected) {
		iotContext += "No specific IoT platform detected in the workspace. Using universal embedded rules.\n"
	}

	// 3. Load Project Memory
	const memoryManager = new IotProjectMemoryManager(cwd)
	await memoryManager.initialize()
	iotContext += await memoryManager.getMemoryContext()

	return iotContext
}

export async function getIotContextSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const template =
		variant.componentOverrides?.[SystemPromptSection.IOT_CONTEXT]?.template || (await getIotContextTemplateText(context))
	return new TemplateEngine().resolve(template, context, {})
}
