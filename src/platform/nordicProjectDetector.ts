/**
 * Nordic Project Configuration Detector
 * Detects RTT vs UART capabilities from project configuration files
 */

import * as fs from "node:fs"
import * as path from "node:path"

export interface ProjectCapabilities {
	hasRTT: boolean
	hasUART: boolean
	recommendedTransport: "rtt" | "uart"
	configPath: string | null
}

/**
 * Scan prj.conf for RTT and UART configuration
 */
function scanPrjConf(prjConfPath: string): ProjectCapabilities {
	const capabilities: ProjectCapabilities = {
		hasRTT: false,
		hasUART: false,
		recommendedTransport: "uart",
		configPath: null,
	}

	if (!fs.existsSync(prjConfPath)) {
		return capabilities
	}

	try {
		const content = fs.readFileSync(prjConfPath, "utf-8")
		capabilities.configPath = prjConfPath

		// Check for RTT configuration
		const hasRTT = /^\s*CONFIG_USE_SEGGER_RTT\s*=\s*y/im.test(content) || /^\s*CONFIG_LOG_BACKEND_RTT\s*=\s*y/im.test(content)

		if (hasRTT) {
			capabilities.hasRTT = true
		}

		// Check for UART configuration
		const hasUART =
			/^\s*CONFIG_LOG_BACKEND_UART\s*=\s*y/im.test(content) ||
			/^\s*CONFIG_SERIAL\s*=\s*y/im.test(content) ||
			/^\s*CONFIG_UART\s*=\s*y/im.test(content)

		if (hasUART || !hasRTT) {
			// UART defaults to true if RTT is not explicitly configured
			capabilities.hasUART = true
		}

		// Recommend based on what's available
		if (hasRTT && !hasUART) {
			capabilities.recommendedTransport = "rtt"
		} else if (!hasRTT && hasUART) {
			capabilities.recommendedTransport = "uart"
		} else if (hasRTT && hasUART) {
			// Both present, RTT is faster
			capabilities.recommendedTransport = "rtt"
		}
	} catch (error) {
		console.error(`Error reading prj.conf: ${error instanceof Error ? error.message : String(error)}`)
	}

	return capabilities
}

/**
 * Detect Nordic project capabilities from workspace
 * Scans for prj.conf in common locations
 */
export function detectProjectCapabilities(workspacePath: string): ProjectCapabilities {
	// Search for prj.conf in common locations
	const searchPaths = [
		path.join(workspacePath, "prj.conf"),
		path.join(workspacePath, "app", "prj.conf"),
		path.join(workspacePath, "src", "prj.conf"),
		path.join(workspacePath, "zephyr", "prj.conf"),
	]

	for (const prjConfPath of searchPaths) {
		if (fs.existsSync(prjConfPath)) {
			return scanPrjConf(prjConfPath)
		}
	}

	// Default if no prj.conf found
	return {
		hasRTT: false,
		hasUART: true,
		recommendedTransport: "uart",
		configPath: null,
	}
}

/**
 * Cache for project capabilities (per workspace path)
 */
const capabilitiesCache = new Map<string, ProjectCapabilities>()

/**
 * Get cached capabilities or detect new ones
 */
export function getCachedCapabilities(workspacePath: string): ProjectCapabilities {
	if (!capabilitiesCache.has(workspacePath)) {
		const capabilities = detectProjectCapabilities(workspacePath)
		capabilitiesCache.set(workspacePath, capabilities)
	}
	return capabilitiesCache.get(workspacePath)!
}

/**
 * Clear cache for a specific workspace (call when prj.conf is modified)
 */
export function clearCapabilitiesCache(workspacePath: string): void {
	capabilitiesCache.delete(workspacePath)
}

/**
 * Clear all cache entries
 */
export function clearAllCapabilitiesCache(): void {
	capabilitiesCache.clear()
}
