/**
 * Webview-side demo scenario registry.
 *
 * The task prompt sent from here is a lightweight trigger string only.
 * The extension host intercepts [ADSUM_DEMO:nus-uart], copies the bundled
 * NCS sample projects to globalStorage, and replaces the text with the full
 * prompt containing real absolute file paths before calling initTask().
 *
 * The inline fallback logs (CENTRAL_LOG etc.) are intentionally removed —
 * the only demo path is through the real-workspace flow.
 */

export interface DemoScenario {
	id: string
	title: string
	honestLabel: string
	/** Lightweight trigger sent to the extension host; host rewrites it before the agent sees it. */
	taskPrompt: string
}

export const DEMO_SCENARIOS: Record<string, DemoScenario> = {
	"nus-uart": {
		id: "nus-uart",
		title: "BLE NUS one-directional communication",
		honestLabel: "Real NCS source + logs from nRF52840DK + nRF5340DK hardware.",
		taskPrompt: "Demo: BLE NUS one-directional bug — no setup needed\n\n[ADSUM_DEMO:nus-uart]",
	},
}

export const DEFAULT_DEMO_SCENARIO_ID = "nus-uart"
