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

export type NordicModeId = "log_generator" | "log_analyzer" | "debug_app" | "generate_app" | "generate_logs"
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
	log_analyzer: {
		id: "log_analyzer",
		icon: "📊",
		title: "Debug Live Device Logs",
		description: "Stream RTT or UART logs from your nRF device and find the root cause fast — I'll propose the fix.",
		systemPrompt: "Analyze device logs",
		initialMessage: "Analyzing workspace and connected devices for log analysis...",
	},
	log_generator: {
		id: "log_generator",
		icon: "🔧",
		title: "Generate Logging Code",
		description: "Inject idiomatic logging where it matters — feeds straight into Debug.",
		systemPrompt: "Generate logging code",
		initialMessage: "Analyzing all open VS Code workspace folders for IoT projects...",
	},
	// ── ESP-IDF modes ──
	debug_app: {
		id: "debug_app",
		icon: "🐞",
		title: "Debug My App",
		description: "Build, flash and read the serial/coredump from your ESP32 — the agent finds the crash and fixes it.",
		systemPrompt: "Debug my ESP32 device",
		initialMessage: "Analyzing the ESP-IDF project and connected ESP32 for debugging...",
	},
	generate_app: {
		id: "generate_app",
		icon: "✨",
		title: "Generate New App",
		description: "Scaffold a Wi-Fi + web-dashboard / sensor app on ESP-IDF, ready to build and flash.",
		systemPrompt: "Generate a new ESP-IDF IoT app",
		initialMessage: "Preparing an ESP-IDF IoT application skeleton...",
	},
	generate_logs: {
		id: "generate_logs",
		icon: "🔧",
		title: "Generate Logging Code",
		description: "Inject ESP-IDF logging into your existing source — feeds straight into Debug.",
		systemPrompt: "Add ESP-IDF logging to my code",
		initialMessage: "Scanning the ESP-IDF project for logging insertion points...",
	},
}

export const MODE_ICONS: Record<NordicModeId, string> = {
	log_generator: aiGeneratedCodeIcon,
	log_analyzer: analyseBugsIcon,
	debug_app: analyseBugsIcon,
	generate_app: aiGeneratedCodeIcon,
	generate_logs: aiGeneratedCodeIcon,
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
