/**
 * IoT Logging Assistant - Mode Definitions
 *
 * Defines the two operating modes for the IoT Logging Assistant:
 * 1. Log Code Generator - adds logging code to C source files
 * 2. Log Analyzer - records & analyzes BLE behavior from connected IoT devices
 *
 * NOTE: Workflow logic has been migrated to iot-knowledge/platforms/nrf/workflows/*.md
 * These prompts are intentionally minimal — the agent reads the workflow files directly.
 */

import { aiGeneratedCodeIcon, analyseBugsIcon } from "@/assets/modeIconsBase64"

export type NordicModeId = "log_generator" | "log_analyzer"
export type NordicChatPhase = "awaiting_mode" | "active" | "task_complete"

export interface NordicModeConfig {
	id: NordicModeId
	icon: string
	title: string
	description: string
	systemPrompt: string
	initialMessage: string
}

export const NORDIC_MODES: Record<NordicModeId, NordicModeConfig> = {
	log_generator: {
		id: "log_generator",
		icon: "🔧",
		title: "Generate Logging Code",
		description: "Automatically inject professional logging into your code following the best practices.",
		systemPrompt: "Generate logging code",
		initialMessage: "Analyzing all open VS Code workspace folders for IoT projects...",
	},
	log_analyzer: {
		id: "log_analyzer",
		icon: "📊",
		title: "Analyze Device Logs",
		description: "Record, analyze, and generate reports from connected IoT devices.",
		systemPrompt: "Analyze device logs",
		initialMessage: "Analyzing workspace and connected devices for log analysis...",
	},
}

export const MODE_ICONS: Record<NordicModeId, string> = {
	log_generator: aiGeneratedCodeIcon,
	log_analyzer: analyseBugsIcon,
}

export function detectModeFromTask(task: string): NordicModeId | null {
	for (const mode of Object.values(NORDIC_MODES)) {
		if (mode.systemPrompt === task) {
			return mode.id
		}
	}
	return null
}

/**
 * Task completion marker that the agent includes in its final message.
 * When detected, the UI shows mode buttons again.
 */
export const TASK_COMPLETE_MARKER = "<!--TASK_COMPLETE-->"
