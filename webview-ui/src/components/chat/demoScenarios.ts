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
	/**
	 * Brief one-line description shown INSTEAD of honestLabel while the row is `comingSoon` — a dimmed roadmap
	 * teaser doesn't need the full sell. When the row goes live (comingSoon off), the full honestLabel returns.
	 */
	teaser?: string
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
		honestLabel: "Runs the real CRA workflow on our pre-built nRF reference sample — not your build.",
		taskPrompt: "Demo: CRA SBOM & Fix on a bundled sample — no project needed\n\n[ADSUM_DEMO:cra-sample]",
		// Sync with DemoManager.buildCraSampleDisplayText() leading text (the chat-bubble prefix recorded in history).
		historyMatch: "Run CRA SBOM & Fix on a pre-built reference sample",
		platform: "nrf",
		icon: "shield",
		isNew: true,
	},
	// HCI + Sniffer (v5) is BUILT — the host handler + the demo-debug-hci kbit (published to the registry) + the
	// bundled captures are all ready. Held as a "coming soon" roadmap row for THIS release; ship it next release by
	// flipping comingSoon off (then run the registry-mode F5 pre-release gate + `kbit:check-drift` first).
	"hci-sniffer": {
		id: "hci-sniffer",
		title: "HCI + sniffer-in-the-loop BLE debug",
		honestLabel:
			"A real one-directional BLE bug across all 3 layers — app log, HCI trace, over-the-air — from nRF hardware. Runs with or without your own boards.",
		taskPrompt: "Demo: HCI + sniffer-in-the-loop BLE debug\n\n[ADSUM_DEMO:hci-sniffer]",
		historyMatch: "HCI + sniffer-in-the-loop BLE debug",
		platform: "nrf",
		icon: "radio-tower",
		comingSoon: true,
		teaser: "BLE, debugged at every layer — app, bus, radio.",
	},
	// A8 — ESP sample placeholder: a Wi-Fi debug session (ESP's connectivity story, parallel to the nRF/BLE HCI
	// row). Disabled "soon" roadmap entry; Omar brings it to life via the host [ADSUM_DEMO:esp-wifi] handler + a
	// bundled ESP-IDF Wi-Fi sample. "Wi-Fi" is highlighted as the row's protocol chip.
	"esp-wifi": {
		id: "esp-wifi",
		title: "Debug an ESP32 Wi-Fi connection issue",
		honestLabel:
			"Build, flash & stream Wi-Fi logs on a bundled ESP-IDF sample project — the agent finds why it won't connect.",
		taskPrompt: "Demo: ESP32 Wi-Fi connection debug\n\n[ADSUM_DEMO:esp-wifi]",
		historyMatch: "Debug an ESP32 Wi-Fi connection issue",
		platform: "esp",
		icon: "broadcast",
		comingSoon: true,
		teaser: "ESP32 Wi-Fi, debugged on real hardware.",
	},
}

export const DEFAULT_DEMO_SCENARIO_ID = "nus-uart"

/**
 * All registered scenarios, ordered for the picker: runnable rows first, "coming soon" placeholders LAST (never
 * lead with a row you can't click), and within each group the "New" rows first (surface new capabilities).
 */
export const DEMO_SCENARIO_LIST: DemoScenario[] = Object.values(DEMO_SCENARIOS).sort((a, b) => {
	if (!!a.comingSoon !== !!b.comingSoon) {
		return a.comingSoon ? 1 : -1
	}
	if (!!a.isNew !== !!b.isNew) {
		return a.isNew ? -1 : 1
	}
	return 0
})

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

/** The set of scenario ids the user has run at least once (by history-prefix match) → drives the "Re-run ▸" label. */
export function ranScenarioIds(tasks: ReadonlyArray<{ task: string }> | undefined): Set<string> {
	const ran = new Set<string>()
	if (!tasks) {
		return ran
	}
	for (const s of DEMO_SCENARIO_LIST) {
		if (tasks.some((t) => t.task?.startsWith(s.historyMatch))) {
			ran.add(s.id)
		}
	}
	return ran
}
