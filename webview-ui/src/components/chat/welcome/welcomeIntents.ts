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
	/** Roadmap card — rendered disabled under an "on the roadmap" divider, never routes. */
	comingSoon?: boolean
}

/** Dev-as-hero prompt strings. projectName is interpolated where relevant. */
export function buildIntentPrompt(id: IntentId, projectName?: string): string {
	const proj = projectName ?? "my project"
	switch (id) {
		case "prototype":
			return "Start a new nRF/Zephyr prototype — tell me what you're building and I'll scaffold it from the right verified Nordic sample."
		case "addFeature":
			return `Add a feature to ${proj} — tell me what you need (Zephyr shell, BLE service, NVS, etc.) and I'll wire it into your build.`
		case "debug":
			return "Stream RTT or UART logs and find the root cause — I'll add logging first if it's missing."
		case "buildFlash":
			return `Build and flash ${proj} — run the loop, build, flash, and watch it come up.`
		case "buildFlashDebug":
			return `Build, flash and debug ${proj} — build and flash it to the board, stream the logs, and help me find any issue.`
		case "testValidate":
			return `Test and validate ${proj} — host tests with native_sim, on-hardware checks when boards are connected.`
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

/** Card description with project-name interpolation where relevant (e.g. "Add a feature to <proj>"). */
export function intentDescription(intent: IntentDef, projectName?: string): string {
	if (intent.id === "addFeature" && projectName) {
		return `A Zephyr shell, a BLE service, NVS storage… wired into ${projectName}, not a sample.`
	}
	return intent.description
}

export const NO_PROJECT_INTENTS: IntentDef[] = [
	{
		id: "prototype",
		icon: "tools",
		title: "Start a prototype",
		description: "Tell me what you're building — I'll scaffold from the right verified Nordic sample.",
		primary: true,
	},
	{
		id: "openProject",
		icon: "folder-opened",
		title: "Open my nRF project",
		description: "Point me at your firmware folder — I'll build it, debug live logs, and add features to your real code.",
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
		description: "I'll build your code, flash it to the board, stream the logs, and help you find any issue.",
		primary: true,
		pill: "Start here",
	},
	{
		id: "addFeature",
		icon: "extensions",
		title: "Add a feature",
		description: "A Zephyr shell, a BLE service, NVS storage… wired into your real project, not a sample.",
	},
	{
		id: "testValidate",
		icon: "beaker",
		title: "Test & validate",
		description: "Prove it works — host tests (native_sim) now, on-hardware checks when a board's connected.",
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
		description: "Move from a DK to your custom board — generate the board files and map the pins.",
		comingSoon: true,
	},
]
