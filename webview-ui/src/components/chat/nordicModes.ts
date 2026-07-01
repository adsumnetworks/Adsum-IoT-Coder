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

/**
 * The structural subset of a chat message this helper reads, so it stays dependency-light + unit-testable.
 */
type CompletionProbe = { type?: string; say?: string; ask?: string; text?: string; partial?: boolean; ts?: number }

/**
 * True when the last chat message means the Nordic task is over and the next-step menu should render. TWO
 * triggers, identical in effect by design:
 *   1. a plain `text` message ENDING with the workflow's TASK_COMPLETE_MARKER (the bit's loop-exit signal); and
 *   2. an attempt_completion result (`completion_result`, whether the `say` or the follow-up `ask`) — the
 *      harness's OWN completion signal. We honor it even without the marker, so the menu still renders when the
 *      model completes via the tool — including a *premature* attempt_completion. This is the R4 safety-net:
 *      the developer always gets a next-step offer at completion, even if the model exited the loop early.
 * Partial/streaming messages are ignored, so it settles on the final message rather than firing mid-stream.
 *
 * The marker must be at the END of the message (after trimming trailing whitespace), NOT merely contained: the
 * workflow specifies "emit it exactly, nothing after it". A model that *quotes the instruction* mid-run
 * ("...end with `<!--TASK_COMPLETE-->` exactly") has text after the marker → not a completion. This stops a
 * premature menu when the agent echoes the workflow file it just read. (The caller additionally only acts on
 * this when the agent is idle, not mid-stream — see ChatView.)
 */
export function isNordicTaskComplete(last?: CompletionProbe | null): boolean {
	if (!last || last.partial === true) {
		return false
	}
	if (last.type === "say" && last.say === "text" && last.text?.trimEnd().endsWith(TASK_COMPLETE_MARKER)) {
		return true
	}
	return last.say === "completion_result" || last.ask === "completion_result"
}

/**
 * True when `last` is a completion that has NOT already flipped the phase to task_complete — i.e. a *fresh*
 * completion the next-step menu should latch onto. `lastLatchedTs` is the ts of the completion that last
 * latched (undefined if none yet).
 *
 * This is the F3 guard. When a developer clicks a next-step card, the phase goes back to "active" but the last
 * chat message is still the PREVIOUS completion until the new turn streams. Without this check the latch would
 * immediately re-fire on that stale completion — re-pinning the chooser as a list footer that the new answer
 * then shoves down, and hiding the input bar. Comparing message-ts to message-ts (same host clock domain) means
 * we only latch a genuinely new completion. A completion with a ts equal to the already-consumed one is ignored.
 */
export function isFreshNordicCompletion(last: CompletionProbe | null | undefined, lastLatchedTs: number | undefined): boolean {
	if (!last || typeof last.ts !== "number") {
		return false
	}
	if (last.ts === lastLatchedTs) {
		return false
	}
	return isNordicTaskComplete(last)
}
