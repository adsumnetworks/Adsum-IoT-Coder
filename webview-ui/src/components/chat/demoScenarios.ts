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
	/**
	 * Placeholder row (A9): shown disabled with a "soon" badge, never runnable, until the owner wires its real
	 * demo path (host [ADSUM_DEMO:<id>] handler + bundled sample). Keeps the picker honest — the row is visible
	 * as a roadmap promise but can't be clicked into a dead end.
	 */
	comingSoon?: boolean
	/** Show a "New" badge on the picker row — used for the CRA + the new BLE-observability (Omar) samples. */
	isNew?: boolean
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
		isNew: true,
	},
	// A9 — Omar's placeholder. Visible as a roadmap row (disabled + "soon"); Omar brings it to life by adding the
	// host [ADSUM_DEMO:hci-sniffer] handler + bundled capture and flipping comingSoon off. HCI lands first; the
	// radio-sniffer layer is the additive frontier — copy leads with the layers honestly.
	"hci-sniffer": {
		id: "hci-sniffer",
		title: "HCI + sniffer-in-the-loop BLE debug",
		honestLabel: "Cross-layer BLE — app log ↔ HCI trace ↔ over-the-air sniffer, correlated by the agent.",
		taskPrompt: "Demo: HCI + sniffer-in-the-loop BLE debug\n\n[ADSUM_DEMO:hci-sniffer]",
		historyMatch: "HCI + sniffer-in-the-loop BLE debug",
		platform: "nrf",
		icon: "radio-tower",
		comingSoon: true,
		isNew: true,
	},
	// A8 — ESP sample placeholder. Same pattern as the HCI row: a disabled "soon" roadmap entry at nRF parity;
	// Omar brings it to life by adding the host [ADSUM_DEMO:esp-coredump] handler + a bundled ESP-IDF sample.
	"esp-coredump": {
		id: "esp-coredump",
		title: "Debug an ESP32 crash from a coredump",
		honestLabel: "Build, flash & read the serial/coredump on a bundled ESP-IDF sample — the agent finds the crash.",
		taskPrompt: "Demo: ESP32 crash + coredump debug\n\n[ADSUM_DEMO:esp-coredump]",
		historyMatch: "Debug an ESP32 crash from a coredump",
		platform: "esp",
		icon: "bug",
		comingSoon: true,
		isNew: true,
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
