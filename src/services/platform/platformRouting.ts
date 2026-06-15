/**
 * platformRouting — pure mapping from the workspace classification summary to the
 * prompt/tool wiring for a task. This is the RUNTIME replacement for the old
 * build-time IOT_PLATFORM flag: an ESP-IDF workspace gets the ESP knowledge and
 * the ESP device tool; an nRF workspace gets the nRF stack; a mixed (both)
 * workspace gets both; an empty (none) workspace gets the neutral default.
 *
 * The identity/persona is a SINGLE platform-neutral `AGENT.md` for every case —
 * its Scope Gate covers both nRF/NCS and ESP-IDF and routes by the detected
 * platform, so there is no per-platform identity file to choose.
 *
 * Kept dependency-free and synchronous so the tool gates and iot_context can call
 * it during prompt assembly, and so it is trivially unit-testable.
 */

import type { WorkspaceSummary } from "./WorkspaceClassifier"

export interface PlatformRouting {
	/** Load the nRF/NCS platform knowledge (when the cwd confirms an nRF project). */
	loadNrf: boolean
	/** Load the ESP-IDF platform knowledge (when the cwd confirms an ESP project). */
	loadEsp: boolean
	/** Inject the multi-platform note that relaxes the single-platform scope gate. */
	multiPlatform: boolean
}

/**
 * Map the workspace summary to the platform wiring for a task.
 *
 * - "esp"  → ESP knowledge only.
 * - "nrf"  → nRF knowledge only.
 * - "both" → BOTH knowledge sets + the multi-platform note.
 * - "none" → no platform knowledge (graceful scope gate).
 *
 * The always-on identity is `AGENT.md` in every case (see module note).
 */
export function routePlatform(summary: WorkspaceSummary): PlatformRouting {
	switch (summary) {
		case "esp":
			return { loadNrf: false, loadEsp: true, multiPlatform: false }
		case "both":
			return { loadNrf: true, loadEsp: true, multiPlatform: true }
		case "nrf":
			return { loadNrf: true, loadEsp: false, multiPlatform: false }
		default:
			return { loadNrf: false, loadEsp: false, multiPlatform: false }
	}
}

/** The nRF device tool (triggerNordicAction) is advertised for nrf, both and none. */
export function nrfToolActive(summary: WorkspaceSummary): boolean {
	return summary === "nrf" || summary === "both" || summary === "none"
}

/**
 * The ESP device tool (triggerEspAction) is advertised for esp, both AND none —
 * symmetric with nrfToolActive. The `none` case matters: scaffolding an ESP
 * prototype from scratch happens in an empty/unclassified workspace, so the native
 * tool must be available *before* any ESP project exists. Without it the agent
 * improvises (execute_command + manual `export.sh`, or a hallucinated MCP server).
 * An nRF-only workspace still hides it (esp tool stays off for summary === "nrf").
 */
export function espToolActive(summary: WorkspaceSummary): boolean {
	return summary === "esp" || summary === "both" || summary === "none"
}
