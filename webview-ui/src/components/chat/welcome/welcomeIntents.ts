export type Tenure = "new" | "dormant" | "returning"

/**
 * Pure tenure classifier.
 * - new: no tasks ever (the real first run).
 * - dormant: has tasks but is re-engaging (showAnnouncement = new version).
 * - returning: active user, no nudge needed.
 * "new" wins over showAnnouncement — a user who installed but never ran a task is new, not dormant.
 */
export function getTenure(p: { taskCount: number; showAnnouncement: boolean }): Tenure {
	if (p.taskCount === 0) {
		return "new"
	}
	if (p.showAnnouncement) {
		return "dormant"
	}
	return "returning"
}

export type IntentId =
	| "demo"
	| "prototype"
	| "openProject"
	| "addFeature"
	| "debug"
	| "buildFlash"
	| "buildFlashDebug"
	| "testValidate"
	| "craCheck"
	| "sdkMigration"
	| "boardBringUp"

export interface IntentDef {
	id: IntentId
	icon: string
	title: string
	description: string
	/** Cyan "hero" treatment + the lead card. */
	primary?: boolean
	/** Small pill shown next to the title (e.g. "Start here"). */
	pill?: string
	/** Optional one-line capability sub-line under the description (injected conditionally, e.g. A10). */
	subline?: string
	/** Roadmap card — rendered disabled under an "on the roadmap" divider, never routes. */
	comingSoon?: boolean
}

/**
 * A10 — the deep-debug capability ladder shown under "Build, flash & debug" for BLE projects.
 * Protocol-neutral (no "BLE" in the label — a Wi-Fi sniffer variant lands later). HCI is the no-dongle
 * layer (lands this sprint); the radio sniffer is the additive frontier (EOS). It names the ladder — it
 * is not a promise that every layer is live today, so it degrades truthfully if the sniffer slips.
 */
export const DEEP_DEBUG_SUBLINE = "↳ deep debug — app logs → HCI → radio sniffer"

export type WorkspacePlatform = "nrf" | "esp" | "both" | "none"

/** Dev-as-hero prompt strings. projectName is interpolated where relevant. */
export function buildIntentPrompt(
	id: IntentId,
	projectName?: string,
	platform: WorkspacePlatform = "both",
	hasBle = false,
): string {
	const proj = projectName ?? "my project"
	switch (id) {
		case "prototype":
			if (platform === "esp")
				return "Start a new ESP-IDF prototype — tell me what you're building and I'll scaffold it from the right verified Espressif example."
			if (platform === "both")
				return "Start a new prototype — tell me whether it's nRF/Zephyr or ESP-IDF and what you're building, and I'll scaffold it from the right verified sample."
			return "Start a new nRF/Zephyr prototype — tell me what you're building and I'll scaffold it from the right verified Nordic sample."
		case "addFeature":
			if (platform === "esp")
				return `Add a feature to ${proj} — tell me what you need (a console command, a Wi-Fi/BLE service, NVS, etc.) and I'll wire it into your build.`
			return `Add a feature to ${proj} — tell me what you need (Zephyr shell, BLE service, NVS, etc.) and I'll wire it into your build.`
		case "debug":
			return "Stream RTT or UART logs and find the root cause — I'll add logging first if it's missing."
		case "buildFlash":
			return `Build and flash ${proj} — run the loop: build it, flash it, and bring it up.`
		case "buildFlashDebug":
			if (hasBle) {
				// BLE project → don't assume the app-log loop. Open by offering the three observability
				// layers and recommend by what's actually connected, then run the chosen one.
				return (
					`Debug ${proj} (a BLE project). Before doing anything, offer me the three ways to observe it and recommend one based on what's connected:\n` +
					`1. App logs — build, flash, and stream the RTT/UART logs (the full inner loop; add logging if it's missing).\n` +
					`2. Over-the-air sniffer — passive radio capture; I just plug in an nRF Sniffer dongle, no rebuild of my board. Tell me which port is the dongle (or detect it).\n` +
					`3. HCI host↔controller trace — needs CONFIG_BT_DEBUG_MONITOR_RTT; if it's off, enable it (rebuild + flash) first, then capture and decode.\n` +
					`Check what's ready now (enumerate serial ports for a sniffer dongle; check whether the HCI monitor is already enabled) and recommend the path needing the least setup or best matching my symptom. When I pick one, LOAD the matching curated workflow first (ble-sniffer or hci-trace) — don't answer from memory — then run it and correlate the decode with my code.`
				)
			}
			return `Build, flash and debug ${proj} — build and flash it to the board, stream the logs, and help me find any issue.`
		case "testValidate":
			if (platform === "esp")
				return `Test and validate ${proj} — host tests (the ESP-IDF "linux" target) or QEMU now, on-hardware Unity checks when a board is connected.`
			if (platform === "both")
				return `Test and validate ${proj} — host/simulator tests now, on-hardware checks when a board is connected.`
			return `Test and validate ${proj} — host tests with native_sim, on-hardware checks when boards are connected.`
		case "craCheck":
			return `Run CRA SBOM & Fix on ${proj} — pull together my SBOM from my real build, preview my secure-by-design posture against the EU Cyber Resilience Act, and surface the top gap so I can decide what to change.`
		case "demo":
			return "Demo: BLE NUS one-directional bug — no setup needed\n\n[ADSUM_DEMO:nus-uart]"
		case "openProject":
			return ""
		// Roadmap placeholders — never invoked (rendered disabled).
		case "sdkMigration":
		case "boardBringUp":
			return ""
	}
}

/** Card description with project-name + platform interpolation (e.g. ESP project → ESP wording). */
export function intentDescription(intent: IntentDef, projectName?: string, platform: WorkspacePlatform = "both"): string {
	const proj = projectName ?? "your project"
	if (intent.id === "addFeature") {
		if (platform === "esp") {
			return `A console command, a Wi-Fi or BLE service, NVS storage… wired into ${proj}, not a sample.`
		}
		if (platform === "both") {
			return `A shell, a BLE/Wi-Fi service, storage… wired into ${proj}, not a sample.`
		}
		return `A Zephyr shell, a BLE service, NVS storage… wired into ${proj}, not a sample.`
	}
	if (intent.id === "prototype") {
		if (platform === "esp") {
			return "Tell me what you're building — I'll scaffold from the right verified ESP-IDF example."
		}
		if (platform === "both") {
			return "Tell me what you're building (nRF/Zephyr or ESP-IDF) — I'll scaffold from the right verified sample."
		}
		return "Tell me what you're building — your prototype, scaffolded from the right verified Nordic sample, ready for you to build on."
	}
	if (intent.id === "testValidate") {
		if (platform === "esp") {
			return "Prove it works — host/QEMU Unity tests now, on-hardware checks when a board's connected."
		}
		if (platform === "both") {
			return "Prove it works — host/simulator tests now, on-hardware checks when a board's connected."
		}
		return intent.description
	}
	if (intent.id === "sdkMigration") {
		if (platform === "esp") {
			return "Bump to a newer ESP-IDF release — I surface the breaking changes and fix them with you."
		}
		if (platform === "both") {
			return "Bump to a newer nRF Connect SDK or ESP-IDF release — I surface the breaking changes and fix them with you."
		}
		return intent.description
	}
	return intent.description
}

/**
 * Decide which platform an intent card should target.
 * - An open, classified project wins (nrf / esp / both).
 * - With no project open, bias by the single installed toolchain; if BOTH or NEITHER
 *   toolchain is present, stay neutral ("both") so the agent asks which platform —
 *   never silently assume nRF (that was the prototype-always-nRF bug).
 */
export function resolveIntentPlatform(
	classification: WorkspacePlatform | undefined,
	toolchains: { nrf: boolean; esp: boolean },
): WorkspacePlatform {
	if (classification && classification !== "none") {
		return classification
	}
	if (toolchains.esp && !toolchains.nrf) {
		return "esp"
	}
	if (toolchains.nrf && !toolchains.esp) {
		return "nrf"
	}
	return "both"
}

export const NO_PROJECT_INTENTS: IntentDef[] = [
	{
		id: "prototype",
		icon: "tools",
		title: "Start a prototype",
		description: "Tell me what you're building — I'll scaffold from the right verified sample.",
	},
	{
		id: "openProject",
		icon: "folder-opened",
		title: "Open my project",
		description:
			"Point me at your firmware folder — I'll help you build it, stream live logs while you debug, and add features to your real code.",
	},
]

/**
 * Project-open next-step cards (Omar's order mock, 2026-06-08):
 * one cyan primary (build/flash/debug — the high-frequency inner-loop + on-hardware wow),
 * then the value work, then verification — plus two greyed roadmap cards (Hick's law: 3 live choices).
 * The standalone "Build & flash" card was intentionally removed (the debug loop already builds + flashes).
 */
export const PROJECT_INTENTS: IntentDef[] = [
	{
		id: "buildFlashDebug",
		icon: "zap",
		title: "Build, flash & debug",
		description: "Build, flash & stream live logs.",
		primary: true,
		pill: "Start here",
	},
	{
		id: "addFeature",
		icon: "extensions",
		title: "Add a feature",
		description: "Add a Zephyr shell, a BLE service, NVS storage… to your real project, not a sample.",
	},
	{
		id: "testValidate",
		icon: "beaker",
		title: "Test & validate",
		description: "Prove it works — host tests (native_sim) now, on-hardware checks when a board's connected.",
	},
	{
		id: "craCheck",
		icon: "shield",
		title: "CRA SBOM & Fix",
		description:
			"From your real build: an SBOM, a secure-by-design posture preview, and a readiness check — so you decide what to fix before the EU CRA.",
		pill: "New",
	},
	{
		id: "sdkMigration",
		icon: "arrow-circle-up",
		title: "SDK Migration",
		description: "Bump to a newer nRF Connect SDK — I surface the breaking changes and fix them with you.",
		comingSoon: true,
	},
	{
		id: "boardBringUp",
		icon: "circuit-board",
		title: "Board Bring-Up",
		description: "Bring up your custom board from a DK — board files drafted and pins mapped, ready for you to verify.",
		comingSoon: true,
	},
]
