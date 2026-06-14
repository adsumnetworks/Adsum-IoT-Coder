/**
 * platformRouting — pure mapping from the workspace classification summary to the
 * prompt/tool wiring for a task. This is the RUNTIME replacement for the old
 * build-time IOT_PLATFORM flag: an ESP-IDF workspace gets the ESP identity, ESP
 * knowledge and the ESP device tool; an nRF workspace gets the nRF stack; a mixed
 * (both) workspace gets both; an empty (none) workspace gets the neutral default.
 *
 * Kept dependency-free and synchronous so the tool gates and iot_context can call
 * it during prompt assembly, and so it is trivially unit-testable.
 */

import type { WorkspaceSummary } from "./WorkspaceClassifier"

export interface PlatformRouting {
	/** Which identity/persona file to load as the always-on base. */
	identity: "AGENT.md" | "AGENT-ESP.md"
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
 * - "esp"  → ESP identity, ESP knowledge only.
 * - "nrf"  → nRF identity, nRF knowledge only.
 * - "both" → nRF-base (neutral) identity + multi-platform note, BOTH knowledge sets.
 * - "none" → nRF-base (neutral) identity, no platform knowledge (graceful scope gate).
 *
 * Note: AGENT.md's *core identity* is already generic ("expert AI assistant for
 * Embedded Systems and IoT"); only its Scope Gate is nRF-specific, which the
 * multi-platform note relaxes for the "both" case.
 */
export function routePlatform(summary: WorkspaceSummary): PlatformRouting {
	switch (summary) {
		case "esp":
			return { identity: "AGENT-ESP.md", loadNrf: false, loadEsp: true, multiPlatform: false }
		case "both":
			return { identity: "AGENT.md", loadNrf: true, loadEsp: true, multiPlatform: true }
		case "nrf":
			return { identity: "AGENT.md", loadNrf: true, loadEsp: false, multiPlatform: false }
		default:
			return { identity: "AGENT.md", loadNrf: false, loadEsp: false, multiPlatform: false }
	}
}

/** The nRF device tool (triggerNordicAction) is advertised for nrf, both and none. */
export function nrfToolActive(summary: WorkspaceSummary): boolean {
	return summary === "nrf" || summary === "both" || summary === "none"
}

/** The ESP device tool (triggerEspAction) is advertised for esp and both. */
export function espToolActive(summary: WorkspaceSummary): boolean {
	return summary === "esp" || summary === "both"
}
