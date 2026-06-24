/**
 * Webview-side demo scenario registry.
 *
 * The task prompt sent from here is a lightweight trigger string only.
 * The extension host intercepts [ADSUM_DEMO:<id>], copies the bundled sample to globalStorage, and replaces
 * the text with the full prompt (real absolute file paths) before calling initTask(). See DemoManager.ts.
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
	/**
	 * Prefix of this scenario's chat-bubble text (= the host buildXDisplayText() leading text). hasRunDemo
	 * matches it in task history to detect a prior run. MUST stay in sync with the host display-text builder.
	 */
	historyMatch: string
	/** Platform badge for the picker. */
	platform: "nrf" | "esp"
	/** codicon name for the picker row. */
	icon: string
}

export const DEMO_SCENARIOS: Record<string, DemoScenario> = {
	"nus-uart": {
		id: "nus-uart",
		title: "BLE NUS one-directional communication",
		honestLabel: "Real NCS source + logs from nRF52840DK + nRF5340DK hardware.",
		taskPrompt: "Demo: BLE NUS one-directional bug — no setup needed\n\n[ADSUM_DEMO:nus-uart]",
		// Sync with DemoManager.buildDemoDisplayText() leading text.
		historyMatch: "Debug a real BLE NUS bug",
		platform: "nrf",
		icon: "debug-alt",
	},
	"cra-sample": {
		id: "cra-sample",
		title: "Preview CRA readiness on a sample",
		honestLabel: "Runs the real CRA workflow on our bundled nRF sample — not your build.",
		taskPrompt: "Demo: CRA SBOM & Fix on a bundled sample — no project needed\n\n[ADSUM_DEMO:cra-sample]",
		// Sync with DemoManager.buildCraSampleDisplayText() leading text.
		historyMatch: "Preview CRA readiness on a bundled sample",
		platform: "nrf",
		icon: "shield",
	},
}

export const DEFAULT_DEMO_SCENARIO_ID = "nus-uart"

/** All registered scenarios. The picker renders these; the count gates whether the picker shows (≥2). */
export const DEMO_SCENARIO_LIST: DemoScenario[] = Object.values(DEMO_SCENARIOS)

/**
 * Stable prefix of the DEFAULT (nus-uart) demo's bubble text. Kept as a named export for the existing
 * sync-anchor test; per-scenario prefixes now live on each scenario's `historyMatch`.
 */
export const DEMO_HISTORY_MATCH = DEMO_SCENARIOS["nus-uart"].historyMatch

/** True once the user has run ANY registered demo at least once (matches any scenario's history prefix). */
export function hasRunDemo(tasks: ReadonlyArray<{ task: string }> | undefined): boolean {
	if (!tasks) {
		return false
	}
	return tasks.some((t) => DEMO_SCENARIO_LIST.some((s) => t.task?.startsWith(s.historyMatch)))
}
