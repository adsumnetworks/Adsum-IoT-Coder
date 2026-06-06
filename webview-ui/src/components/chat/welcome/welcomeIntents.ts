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

export type IntentId = "demo" | "prototype" | "openProject" | "addFeature" | "debug" | "buildFlash" | "testValidate"

export interface IntentDef {
	id: IntentId
	icon: string
	title: string
	description: string
	primary?: boolean
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
		case "testValidate":
			return `Test and validate ${proj} — host tests with native_sim, on-hardware checks when boards are connected.`
		case "demo":
			return "Demo: BLE NUS one-directional bug — no setup needed\n\n[ADSUM_DEMO:nus-uart]"
		case "openProject":
			return ""
	}
}

export const NO_PROJECT_INTENTS: IntentDef[] = [
	{
		id: "prototype",
		icon: "tools",
		title: "Start a prototype",
		description: "Tell me what you're building — I'll scaffold from the right verified Nordic sample.",
	},
	{
		id: "openProject",
		icon: "folder-opened",
		title: "Open my nRF project",
		description: "Point me at your firmware folder — I'll build it, debug live logs, and add features to your real code.",
	},
]

export const PROJECT_INTENTS: IntentDef[] = [
	{
		id: "addFeature",
		icon: "add",
		title: "Add a feature",
		description: "Zephyr shell, BLE service, or NVS — I'll wire it into your build.",
		primary: true,
	},
	{
		id: "debug",
		icon: "bug",
		title: "Debug this device",
		description: "Stream RTT/UART logs and find the root cause — I'll add logging first if it's missing.",
	},
	{
		id: "buildFlash",
		icon: "zap",
		title: "Build & flash",
		description: "Run the loop — build, flash, and watch it come up.",
	},
	{
		id: "testValidate",
		icon: "check-all",
		title: "Test & validate",
		description: "Prove it works — host tests with native_sim, on-hardware checks when boards are connected.",
	},
]
