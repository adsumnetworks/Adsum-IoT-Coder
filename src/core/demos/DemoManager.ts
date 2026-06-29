import type { NrfEnvironment } from "@shared/nrf"
import fs from "fs/promises"
import * as path from "path"
import { ExtensionRegistryInfo } from "@/registry"
import { resolveBitPathSync } from "@/services/knowledge/KnowledgeResolver"

// ── Module-level singleton, set once during extension activation ──────────────

let _extensionPath: string | null = null
let _globalStoragePath: string | null = null

/**
 * Call once from src/common.ts activate() before any demo can be triggered.
 * Accepts plain strings so this module stays host-agnostic (no vscode import).
 *   extensionPath    = context.extensionPath
 *   globalStoragePath = context.globalStorageUri.fsPath
 */
export function initDemoManager(extensionPath: string, globalStoragePath: string): void {
	_extensionPath = extensionPath
	_globalStoragePath = globalStoragePath
}

// ── Public API ────────────────────────────────────────────────────────────────

const SCENARIO_ID = "nus-uart"

/** Prefix embedded in the webview task text to trigger the real demo flow. */
export const DEMO_TRIGGER = "[ADSUM_DEMO:nus-uart]"

/** What the host machine can support for the demo escalation. */
export type DemoCapability = "canned" | "build" | "hardware"

/**
 * Pure capability classifier — defaults to "canned" on any ambiguity so the
 * bulletproof floor never degrades. Consumes the Increment 3 env cache directly.
 */
export function classifyDemoCapability(env: NrfEnvironment | undefined): DemoCapability {
	if (!env || env.status !== "ready") {
		return "canned"
	}
	const hasNcs = !!env.projectSdk || (env.installedSdkVersions?.length ?? 0) > 0
	if (!hasNcs) {
		return "canned"
	}
	// nrfutil + boards required for flash/capture; NCS alone is enough for west build.
	if (env.nrfutilPresent && env.boards.length >= 1) {
		return "hardware"
	}
	return "build"
}

export interface DemoWorkspace {
	/** Absolute path to the demo root in globalStorage (writable). */
	rootPath: string
	/** Absolute path to the central_uart project. */
	centralPath: string
	/** Absolute path to the peripheral_uart project. */
	peripheralPath: string
}

/**
 * Ensures the bundled NUS demo sample is copied to a writable location in
 * globalStorage. The extension install dir is read-only, so the agent needs
 * to read from the copied location (where `west build` can also write later).
 *
 * Returns paths the extension host uses to build the agent's task prompt so
 * the agent calls read_file on real files rather than pasted snippets.
 */
export async function prepareDemoWorkspace(): Promise<DemoWorkspace> {
	if (!_extensionPath || !_globalStoragePath) {
		throw new Error("DemoManager not initialized — call initDemoManager() in activate()")
	}

	const version = ExtensionRegistryInfo.version
	const demoRoot = path.join(_globalStoragePath, "demo", `${SCENARIO_ID}-${version}`)
	const centralPath = path.join(demoRoot, "central_uart")
	const peripheralPath = path.join(demoRoot, "peripheral_uart")

	// Always re-copy the bundled assets so the demo is pristine (bug present) on every run.
	// The build escalation works on a throwaway /tmp copy, so it never mutates these files —
	// but re-copying is self-healing against any prior corruption (e.g. a fix written in place).
	const bundledRoot = path.join(_extensionPath, "demo-scenarios", SCENARIO_ID)
	await copyDir(bundledRoot, demoRoot)

	return { rootPath: demoRoot, centralPath, peripheralPath }
}

/**
 * Short, honest one-liner shown in the chat bubble in place of the full runbook.
 * No file paths, no five-beat framing, no escalation copy, no SDK version, no build steps —
 * just the human framing a developer would actually see when launching the demo.
 */
// NOTE: the leading "Debug a real BLE NUS bug" must stay in sync with DEMO_HISTORY_MATCH
// (webview-ui/src/components/chat/demoScenarios.ts) — the webview detects a prior demo run by
// matching this prefix in task history to demote the welcome demo card to a secondary "Re-run".
export function buildDemoDisplayText(): string {
	return (
		"Debug a real BLE NUS bug — Central→Peripheral works, but Peripheral→Central is silently dropped. " +
		"RTT logs captured from real nRF52840DK + nRF5340DK hardware."
	)
}

/** Builds the full agent task prompt pointing at real files in globalStorage. */
export function buildDemoPrompt(ws: DemoWorkspace, capability: DemoCapability = "canned", env?: NrfEnvironment): string {
	const workflowFile =
		resolveBitPathSync("adsum/nrf/workflows/demo-debug") ??
		path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "workflows", "demo-debug.md")
	const bleFile =
		resolveBitPathSync("adsum/nrf/sdks/ncs/protocols/ble") ??
		path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "sdks", "ncs", "protocols", "BLE.md")
	const centralLog = path.join(ws.centralPath, "logs", "rtt", "central_683907940_20260606_162933.log")
	const peripheralLog = path.join(ws.peripheralPath, "logs", "rtt", "peripheral_960167369_20260606_162933.log")
	const centralSrc = path.join(ws.centralPath, "src", "main.c")
	const peripheralSrc = path.join(ws.peripheralPath, "src", "main.c")

	const escalation = buildEscalationBlock(capability, ws, env)

	return `Demo: BLE NUS one-directional bug — no setup needed

[ADSUM_DEMO:nus-uart] You are debugging a real NCS workspace. \
Logs were captured from real nRF52840DK (central) + nRF5340DK (peripheral) hardware.

CRITICAL — read this before doing anything:

- Open with a hook, then read. Write a short intro (2–3 sentences) TO the developer before the reads: \
frame the mission — a real, subtle one-directional BLE NUS bug captured from two physical Nordic boards — \
name the evidence you're bringing in (the RTT logs from both boards, both firmware sources, and the NUS \
protocol reference), and invite them to follow you to the fix and the live compile proof at the end. \
Describe the evidence you're gathering, NOT the act of reading files: "let me pull the RTT logs from both \
boards and both firmware sources", never "I'll read six files" / "I'll read silently". Keep it credible \
for an embedded engineer — no hype, no "get ready to be amazed". Name the evidence by ROLE only; state \
nothing about what any file CONTAINS. This intro is the only text before the reads.
- Keep every finding, reaction, and the topology for the beats — never react to a file before the reads \
finish. The six reads render to the user as a single collapsed "read 6 files" step; a finding stated \
before that step appears ABOVE it and reads backwards, as if you concluded before opening the files. Your \
first output AFTER the reads is Beat 1.
- Do NOT name the missing function or the fix before Beat 3. The escalation/build section near the end of \
these instructions spells out the exact fix — that text exists ONLY for the build step, AFTER the reveal. \
Across Beats 1–2 you build from evidence alone (silence after discovery, failed sends, an incomplete \
handshake); the first time you may name bt_nus_subscribe_receive() is Beat 3. Leading with the answer \
destroys the demo — this is the single most important rule.
- The central source is the buggy version and is intentionally missing the fix; that is expected — do not \
flag it as already-fixed.
- The verdict is EARNED by the reads and beats, never recited from these instructions. If the developer \
interrupts, skips ahead, or asks you to wrap up / mark the task complete BEFORE you have actually read the \
six files and worked through Beats 1–3, do NOT state a root cause, do NOT name bt_nus_subscribe_receive(), \
and do NOT call attempt_completion with a diagnosis. Say plainly that the analysis didn't get to run and \
offer to start it from the top. A diagnosis you produce without having opened the files reads as pre-canned \
and destroys the developer's trust — the whole point is that the answer comes from the evidence in session.

Files (read all six silently, in order):
1. Debugging guide:    ${workflowFile}
2. Central RTT log:    ${centralLog}
3. Peripheral RTT log: ${peripheralLog}
4. BLE protocol ref:   ${bleFile}
5. Central source:     ${centralSrc}
6. Peripheral source:  ${peripheralSrc}

After reading all six files, present the five beats immediately — no ask-gate, no "Ready to present?", \
no confirmation step, no button choices before the beats. The reads are the run-up; Beat 1 follows directly.
Beats 1 and 3 each REQUIRE their mermaid diagram, reproduced verbatim from the workflow — never replace a \
diagram with prose. Be direct and educational — you are showing a developer a real nRF bug.

You may call attempt_completion only AFTER you have done the reads and presented the beats — never before. \
State the root-cause verdict in ONE sentence as a normal message (do NOT repeat the five beats — they are \
already in the conversation stream, and re-rendering them creates a confusing triple-presentation). Then do \
NOT call attempt_completion yet: present the next-step choice in the section below as a button question, using \
the ask_followup_question tool with real option buttons, and complete the task only once the developer has \
chosen. (If the flow was cut short per the rule above, there is no verdict and no choice to offer — say the \
analysis didn't run rather than completing with a canned diagnosis.)
${escalation}`
}

// ── CRA-on-sample scenario (the guaranteed 2nd picker entry — A1.2) ────────────
// Runs the REAL cra-readiness workflow on the bundled sample via the workflow's preview path. No canned
// result: the bit drives it (SBOM ladder degrades to SBOM-lite without NCS), so honesty is the bit's job.

/** Chat-bubble text for the CRA-on-sample preview. Its prefix is what hasRunDemo matches for this scenario. */
export function buildCraSampleDisplayText(): string {
	return (
		"Preview CRA readiness on a bundled sample — a real SBOM + a secure-by-design posture for the EU Cyber " +
		"Resilience Act, on our nRF sample (not your build)."
	)
}

/** Prompt that runs the cra-readiness workflow on the bundled sample (preview path). Thin trigger; the bit leads. */
function buildCraSamplePrompt(samplePath: string): string {
	// cra-readiness is a DOWNLOADED (proprietary) bit — migrated to Adsum-Backend/kbits/, no longer bundled in
	// the VSIX. Reference it by its bare k-bit path: the read_file handler resolves it through the resolver
	// (loadBitByRel → loadBit), which serves it from the ADSUM_KBIT_LOCAL override in dev (F5) and the registry
	// in prod (once published + entitled at Phase-D). It is NOT an absolute fs path anymore — no bundled file exists.
	const workflowFile = "cra/workflows/cra-readiness.md"
	return `Run CRA SBOM & Fix on the bundled sample project at ${samplePath}.

[ADSUM_DEMO:cra-sample] This is OUR bundled nRF sample (central_uart), NOT the user's own project — it is the \
workflow's PREVIEW path. Detect the platform, generate the SBOM, preview the secure-by-design posture, surface \
the top gap, then offer to start closing it.

Hard rules for this sample run:
- Load and follow the workflow exactly: read_file ${workflowFile}. **If that read fails (the bit isn't \
available), STOP: tell the developer the CRA workflow is currently unavailable and do NOT proceed. Never \
reconstruct the workflow, or template the report, from general knowledge, memory, or a PRIOR CRA run/report — \
an improvised assessment is ungrounded and not allowed.** It carries the honesty rules — evidence-mode \
only, NO verdicts / grades / scores (no status glyphs, no "MET"/"READY"/"GOOD", no "N/10" or aggregate score, no \
"non-compliant"), the mandatory "# CRA SBOM & Fix" title + the "Readiness aid — NOT a conformity assessment" \
disclaimer, and curated citations only (Annex Part I / Part II + the curated Article 14 — never invent a sub-clause \
such as "Article 3(8)").
- It is our READ-ONLY sample: NEVER write into it or the extension. Show the report INLINE; ask via \
ask_followup_question before saving, and only on consent save to a namespaced folder under the user's Desktop. \
State plainly the result describes the sample, not the user's product — for their own build they run it on their code.
- Follow the productive next-step loop: after the preview, offer the top gap as one concrete, decline-able step; \
do NOT call attempt_completion while a high-value gap is still un-offered and the user has not declined.`
}

// ── Generic bundled-scenario prep (esp-wifi, hci-sniffer) ─────────────────────
// Copies demo-scenarios/<id> to a writable globalStorage location, like prepareDemoWorkspace
// but for any id-keyed scenario whose evidence is bundled capture files (not the NUS sample).

async function prepareScenarioBundle(id: string): Promise<string> {
	if (!_extensionPath || !_globalStoragePath) {
		throw new Error("DemoManager not initialized — call initDemoManager() in activate()")
	}
	const version = ExtensionRegistryInfo.version
	const bundleRoot = path.join(_globalStoragePath, "demo", `${id}-${version}`)
	await copyDir(path.join(_extensionPath, "demo-scenarios", id), bundleRoot)
	return bundleRoot
}

// ── ESP32 Wi-Fi "connected but offline" scenario (esp-wifi) ────────────────────

export function buildEspWifiDisplayText(): string {
	// Leading text MUST stay in sync with demoScenarios.ts historyMatch for "esp-wifi".
	return (
		"Debug an ESP32 Wi-Fi connection issue — the board says 'connected' but the first DNS lookup fails. " +
		"Serial logs captured from a real ESP32-S3."
	)
}

function buildEspWifiPrompt(bundleRoot: string): string {
	const buggyLog = path.join(bundleRoot, "logs", "wifi_buggy.log")
	const fixedLog = path.join(bundleRoot, "logs", "wifi_fixed.log")
	const source = path.join(bundleRoot, "main", "station_example_main.c")
	const espKnowledge =
		resolveBitPathSync("adsum/esp/platform") ?? path.join(_extensionPath!, "iot-knowledge", "platforms", "esp", "PLATFORM.md")

	return `Demo: ESP32 Wi-Fi connection debug — no setup needed

[ADSUM_DEMO:esp-wifi] You are debugging a real ESP-IDF Wi-Fi station. The serial logs were captured from a real ESP32-S3; the SSID is sanitized.

CRITICAL — read this before doing anything:
- Open with a short hook (2–3 sentences) TO the developer: frame the mission — an ESP32 that associates with the AP and logs "connected", yet its first network call fails — name the evidence you're bringing in (the captured serial log of the failing run, the ESP Wi-Fi platform knowledge, and the firmware source), and invite them to follow you to the root cause and the one-line fix. Name evidence by ROLE only; say nothing about what any file CONTAINS.
- Read all three files SILENTLY, in order, before reacting. Do NOT state a cause before the reads finish.
- Do NOT name the fix (the WIFI_EVENT_STA_CONNECTED vs IP_EVENT_STA_GOT_IP event swap) before you have shown, from the log, the timeline that proves it: the DNS failure happens BEFORE the IP is assigned.

Files (read all three silently, in order):
1. Failing serial log:   ${buggyLog}
2. ESP Wi-Fi knowledge:  ${espKnowledge}
3. Firmware source:      ${source}

After the reads, walk the developer through it:
- The log shows the radio associates and the app logs "connected", then getaddrinfo (DNS) fails — and the "got ip" line lands ~3 seconds AFTER that failure. That ordering is the whole story.
- In the source (event_handler), the app signals network-ready on WIFI_EVENT_STA_CONNECTED (link up, no IP yet) instead of IP_EVENT_STA_GOT_IP. So check_connectivity() runs before DHCP finishes.
- The fix is one event: signal readiness on IP_EVENT_STA_GOT_IP, not WIFI_EVENT_STA_CONNECTED. Then the first network call only runs once an address exists.

Be direct and educational — you are showing an embedded developer a real, common ESP-IDF Wi-Fi gotcha. Cite the evidence (timestamps from the log), never assert from memory.

Then present the next step as BUTTONS via ask_followup_question. Ask: "That's the bug — the app used the network before it had an IP. Want to see proof?"
Options:
- "Show me the fixed run"
- "I've seen enough — wrap up"

If they pick "Show me the fixed run": read ${fixedLog} and point out that with readiness gated on IP_EVENT_STA_GOT_IP, the order is now "got ip" → DNS resolves successfully — same board, same network, fixed by the one-event change. Then call attempt_completion with a one-line conclusion and end the final message with exactly: <!--TASK_COMPLETE-->
If they pick "I've seen enough — wrap up": give a two-sentence recap (root cause + the one-event fix), invite them to point Adsum at their own ESP-IDF project, and end with <!--TASK_COMPLETE-->`
}

// ── BLE HCI + over-the-air sniffer cross-layer scenario (hci-sniffer) ──────────

export function buildHciSnifferDisplayText(): string {
	// Leading text MUST stay in sync with demoScenarios.ts historyMatch for "hci-sniffer".
	return (
		"HCI + sniffer-in-the-loop BLE debug — a real one-directional BLE bug seen across all three layers " +
		"(app log, HCI host↔controller trace, over-the-air sniffer), captured from nRF hardware."
	)
}

/** The three buggy decoded logs the host opens in editor tabs at launch (relative to the bundle root). */
export function hciSnifferOpenInEditor(bundleRoot: string): string[] {
	return [
		path.join(bundleRoot, "logs", "buggy", "app.log"),
		path.join(bundleRoot, "logs", "buggy", "hci.hci.log"),
		path.join(bundleRoot, "logs", "buggy", "sniffer.sniffer.log"),
	]
}

export function buildHciSnifferPrompt(bundleRoot: string, capability: DemoCapability): string {
	const L = (tier: "buggy" | "fixed", layer: string) => path.join(bundleRoot, "logs", tier, layer)
	const bleFile =
		resolveBitPathSync("adsum/nrf/sdks/ncs/protocols/ble") ??
		path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "sdks", "ncs", "protocols", "BLE.md")

	return `Demo: HCI + sniffer-in-the-loop BLE debug — no setup needed

[ADSUM_DEMO:hci-sniffer] You are running Adsum's flagship BLE observability demo for a developer EVALUATING the tool — this is a first impression and an acquisition moment. The three real captures (app log, HCI trace, over-the-air sniffer) are ALREADY OPEN in their editor tabs. Make them say "wow", fast.

=== STYLE CONTRACT — follow exactly, this is the point of the redesign ===
- Lead with the goal. NO "let me walk you through what I'm going to do", no meta-narration.
- SHORT. Titled sections ("## App layer", etc.), ≤2 sentences each, cite the ONE decisive line — never paragraphs, never a wall of text. Developers won't read walls.
- Use a mermaid \`sequenceDiagram\` for any flow — never describe a flow in prose.
- END EVERY STEP with an ask_followup_question button choice. Never dump everything at once.

=== THE BUG ===
One-directional NUS: the central connects and discovers the peripheral's Nordic UART Service, but never SUBSCRIBES to its TX characteristic (it skips bt_nus_subscribe_receive after bt_nus_handles_assign). So the peripheral's notifications are silently dropped — peripheral→central data never arrives. The signature is visible at all three layers: no CCCD write in HCI, no notifications on air, nothing received in the app log.

=== STEP 1 — Hook + scan (your FIRST message, keep it tiny) ===
- One sentence of framing, then this mermaid VERBATIM:
\`\`\`mermaid
sequenceDiagram
  participant P as Peripheral
  participant C as Central
  C->>P: connect + discover NUS
  Note over C: never subscribes (the bug)
  P-->>C: notify "hello" — dropped, no subscriber
\`\`\`
- Then SCAN their hardware so they SEE you read their bench: call triggerNordicAction with action="log_device", operation="list". In ONE line, report what's connected — a DK is a board like PCA10056/PCA10040 (J-Link); a sniffer is "nRF Sniffer for Bluetooth LE" or, if unflashed, "Open DFU Bootloader" / PCA10059.
- Then ask with buttons. Include ONLY options their hardware supports; the captured-walkthrough is ALWAYS offered. (Host capability hint: capability=${capability} — "hardware" means at least one DK is present.)
  ask_followup_question — Question: "How do you want to see it?"
  Options:
    - "Walk me through the captured bug"            ← ALWAYS include
    - "Capture HCI live on my own board"            ← include ONLY if you scanned a connected DK
    - "Capture live + sniff it over the air"        ← include ONLY if you scanned a DK AND a sniffer dongle

=== STEP 2A — "Walk me through the captured bug" (the hero path; works with NO hardware) ===
The three buggy logs are already open in their editor. Walk the three layers — each a short titled section citing the ONE decisive line, naming the open file:
- ## App layer (buggy/app.log): the peripheral sends, the central never prints it — the dropped-data line.
- ## HCI layer (buggy/hci.hci.log): the central's host↔controller trace shows service discovery but NO GATT write to the CCCD — the subscribe never happens.
- ## Over-the-air (buggy/sniffer.sniffer.log): the air shows the connection but no CCCD write and no peripheral→central notifications.
Then ONE cross-layer mermaid tying app-intent → HCI → air. Then:
- ## The one-line fix: add \`bt_nus_subscribe_receive(nus);\` right after \`bt_nus_handles_assign(dm, nus);\` — that single line makes the central subscribe, so the CCCD write goes out and the notifications flow.
- ## Proof — try to read the FIXED captures (${L("fixed", "hci.hci.log")}, ${L("fixed", "sniffer.sniffer.log")}, ${L("fixed", "app.log")}). IF they exist, show the before/after: the CCCD write + notifications now appear in HCI + air and the data arrives in the app log — same boards, one line. IF a fixed capture is missing, do NOT fabricate it: just show the fix in code and say the fixed run can be reproduced live on connected boards.
Close with buttons — Question: "That's the whole loop. Where to next?"
Options: ["Run this on my own nRF project", "I've seen enough — wrap up"].

=== STEP 2B / 2C — live on their hardware (only if they picked it) ===
Reproduce the SAME signature on their board(s); do not improvise raw shell. Load the action/workflow bits first (read_file the relevant ones: ${bleFile} for the layer map, plus the hci-trace and — for 2C — ble-sniffer workflows). Then:
- Flash the buggy NUS central + peripheral (HCI monitor enabled) to their DK(s) by serial, let them connect.
- Capture HCI live: triggerNordicAction action="log_device", operation="capture", transport="rtt", monitor="true". Show the live trace has the SAME missing-CCCD signature as the captured one.
- 2C only: also sniff over the air — triggerNordicAction operation="sniff" with the dongle's port — and correlate with the live HCI.
- Then reveal the one-line fix, reflash central, and show the CCCD write + notifications now appear live. No phone needed.
Close with the same final buttons.

=== Reference files (read on demand, never dumped) ===
- BLE layer map (the 3-layer escalation): ${bleFile}
- Buggy captures (already open): ${L("buggy", "app.log")} · ${L("buggy", "hci.hci.log")} · ${L("buggy", "sniffer.sniffer.log")}
- Fixed captures (for the proof): ${L("fixed", "app.log")} · ${L("fixed", "hci.hci.log")} · ${L("fixed", "sniffer.sniffer.log")}

Call attempt_completion only after a final button choice resolves; end the final message with exactly, nothing after it: <!--TASK_COMPLETE-->`
}

// ── Scenario registry (id-keyed) ──────────────────────────────────────────────
// A1: the demo system is generalizing from a single hardcoded scenario to an id-keyed registry so the
// welcome "Try it on a sample" picker can host more than one demo (CRA-on-sample, Omar's HCI). Today the
// only live entry is nus-uart, wrapping the functions above unchanged — adding a scenario is now additive.

export interface HostDemoScenario {
	/** Stable id, also the telemetry key (matches the `[ADSUM_DEMO:<id>]` trigger). */
	id: string
	/** The exact trigger token the webview sends for this scenario. */
	triggerToken: string
	/** Prepare the bundle (if any) + build the full agent prompt and the chat-bubble display text.
	 * Optionally returns absolute paths the host should OPEN in editor tabs at launch (e.g. pre-captured
	 * demo logs the user should see — used by hci-sniffer, which runs with no workspace open). */
	buildTask(env: NrfEnvironment | undefined): Promise<{ taskText: string; displayText: string; openInEditor?: string[] }>
}

const HOST_DEMO_SCENARIOS: Record<string, HostDemoScenario> = {
	[SCENARIO_ID]: {
		id: SCENARIO_ID,
		triggerToken: DEMO_TRIGGER,
		async buildTask(env) {
			const ws = await prepareDemoWorkspace()
			const capability = classifyDemoCapability(env)
			return { taskText: buildDemoPrompt(ws, capability, env), displayText: buildDemoDisplayText() }
		},
	},
	"cra-sample": {
		id: "cra-sample",
		triggerToken: "[ADSUM_DEMO:cra-sample]",
		async buildTask() {
			const ws = await prepareDemoWorkspace()
			return { taskText: buildCraSamplePrompt(ws.centralPath), displayText: buildCraSampleDisplayText() }
		},
	},
	"esp-wifi": {
		id: "esp-wifi",
		triggerToken: "[ADSUM_DEMO:esp-wifi]",
		async buildTask() {
			const bundleRoot = await prepareScenarioBundle("esp-wifi")
			return { taskText: buildEspWifiPrompt(bundleRoot), displayText: buildEspWifiDisplayText() }
		},
	},
	"hci-sniffer": {
		id: "hci-sniffer",
		triggerToken: "[ADSUM_DEMO:hci-sniffer]",
		async buildTask(env) {
			const bundleRoot = await prepareScenarioBundle("hci-sniffer")
			const capability = classifyDemoCapability(env)
			return {
				taskText: buildHciSnifferPrompt(bundleRoot, capability),
				displayText: buildHciSnifferDisplayText(),
				openInEditor: hciSnifferOpenInEditor(bundleRoot),
			}
		},
	},
}

/** Extract the demo id from an `[ADSUM_DEMO:<id>]` trigger; null if absent or not registered. */
export function parseDemoTrigger(text: string): string | null {
	const id = text.match(/\[ADSUM_DEMO:([a-z0-9-]+)\]/i)?.[1]
	return id && id in HOST_DEMO_SCENARIOS ? id : null
}

/** Look up a registered host demo scenario by id. */
export function getHostDemoScenario(id: string): HostDemoScenario | undefined {
	return HOST_DEMO_SCENARIOS[id]
}

// ── Private helpers ───────────────────────────────────────────────────────────

function buildEscalationBlock(capability: DemoCapability, ws: DemoWorkspace, env?: NrfEnvironment): string {
	// Shared across all tiers: the always-present "stop" path and the invitation to ask instead of pick.
	const wrapUp = `If the developer picks "I've seen enough — wrap up" (or says they are done): reply with a brief two-sentence conclusion — recap the root cause in one line, then invite them to point Adsum at their own nRF firmware — and call attempt_completion with that conclusion. End the final message with exactly, nothing after it: <!--TASK_COMPLETE-->`
	const askAnything = `The buttons are suggestions, not a cage — the developer can also just type a question (about this bug, the one-line fix, the NUS protocol, or NCS in general). If they ask instead of choosing, answer it concisely from the evidence already on screen, then offer the same choice again rather than completing.`

	if (capability === "build") {
		const sdkVersion = env?.installedSdkVersions?.[0] ?? "NCS"
		return `
After your five-beat analysis and one-sentence verdict, present the next step as BUTTONS using the ask_followup_question tool (never as "type this" free text). Ask exactly this:

Question: "That's the bug. Want proof the fix is real — not something I made up? You have ${sdkVersion} installed, so I can apply the one-line fix and compile the central firmware right here — no boards needed."
Options:
- "Build it — prove the fix compiles"
- "I've seen enough — wrap up"

${askAnything}

If the developer picks "Build it — prove the fix compiles", do the following steps in order. Do NOT edit the demo source in place —
work on a throwaway copy in /tmp so the demo stays pristine for the next run:

1. Copy the central project to a clean build location. This also avoids CMake's space-in-path bug:
   \`\`\`
   rm -rf /tmp/adsum_demo_central /tmp/adsum_demo_build && cp -R "${ws.centralPath}" /tmp/adsum_demo_central
   \`\`\`
2. Apply the fix in the COPY only. In \`/tmp/adsum_demo_central/src/main.c\`, inside \`discovery_complete()\`, add this line immediately after \`bt_nus_handles_assign(dm, nus);\`:
   \`\`\`c
   bt_nus_subscribe_receive(nus);
   \`\`\`
   (The demo source you analyzed is the buggy version and is missing this line — that is expected. Add it to the /tmp copy.)
3. Build with west from inside the NCS workspace:
   \`\`\`
   west build -s /tmp/adsum_demo_central -b nrf52840dk/nrf52840 -d /tmp/adsum_demo_build
   \`\`\`
4. If it compiles clean: tell the developer "The fix compiles on NCS ${sdkVersion}. \`bt_nus_subscribe_receive()\` is a real SDK API — the diagnosis was accurate. Connect two boards to see it run live." Then end the task with \`<!--TASK_COMPLETE-->\`.
5. If it fails: show the compiler error verbatim and explain what it means. Then end the task with \`<!--TASK_COMPLETE-->\`.

${wrapUp}
`
	}

	if (capability === "hardware") {
		const boardCount = env?.boards?.length ?? 1
		const boardWord = boardCount >= 2 ? `${boardCount} boards` : "a board"
		const flashDoc =
			resolveBitPathSync("adsum/nrf/actions/flash") ??
			path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "actions", "flash.md")
		const captureDoc =
			resolveBitPathSync("adsum/nrf/actions/capture-logs") ??
			path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "actions", "capture-logs.md")
		return `
After your five-beat analysis and one-sentence verdict, present the next step as BUTTONS using the ask_followup_question tool (never as "type this" free text). Ask exactly this:

Question: "That's the bug. Want to see it fail and then pass on your own hardware? You have ${boardWord} connected — I can flash the buggy firmware, capture real RTT, reproduce the failure, then apply the fix and confirm it end-to-end."
Options:
- "Flash & run it live on my boards"
- "Just build it — no boards needed"
- "I've seen enough — wrap up"

${askAnything}

If the developer picks "Flash & run it live on my boards", reproduce it live using the project's REAL flash and capture actions — do NOT
improvise with raw shell, and do NOT hand-roll RTT capture. Read and follow these two action guides first:
- Flash:   ${flashDoc}
- Capture: ${captureDoc}

Then do the following in order:

1. Process cleanup, then list devices to get the two J-Link serial numbers (per the flash guide):
   \`\`\`
   pkill -9 JLink 2>/dev/null; pkill -9 nrfutil 2>/dev/null
   nrfutil device list
   \`\`\`
   Confirm each device's family with \`nrfutil device device-info --serial-number <SN>\` before flashing it —
   the nRF52840DK runs central_uart, the nRF5340DK runs peripheral_uart. Do not guess which serial is which.

2. Build BOTH projects (buggy, unfixed) on throwaway /tmp copies. Never build inside the globalStorage path
   and never symlink — copying to /tmp is what avoids CMake's space-in-path failure:
   \`\`\`
   rm -rf /tmp/adsum_demo_central /tmp/adsum_demo_peripheral
   cp -R "${ws.centralPath}" /tmp/adsum_demo_central
   cp -R "${ws.peripheralPath}" /tmp/adsum_demo_peripheral
   west build -s /tmp/adsum_demo_central    -b nrf52840dk/nrf52840    -d /tmp/adsum_demo_central/build
   west build -s /tmp/adsum_demo_peripheral -b nrf5340dk/nrf5340/cpuapp -d /tmp/adsum_demo_peripheral/build
   \`\`\`

3. Flash each board by serial (per the flash guide — always use --snr so the right board gets the right image):
   \`\`\`
   west flash -d /tmp/adsum_demo_central/build    --snr <central_sn>
   west flash -d /tmp/adsum_demo_peripheral/build --snr <peripheral_sn>
   \`\`\`

4. Set up the live proof — this is hands-on for the developer, so teach them first and WAIT. The broken
   direction (peripheral -> central) only happens when the peripheral has UART input to forward, and the
   central does NOT log received data (it forwards it to its own UART). So the proof is what the developer
   SEES in two serial terminals, backed by the peripheral's RTT. From the device list, identify each board's
   application UART — the nRF52840DK central's VCOM, and the nRF5340DK peripheral's FIRST VCOM (vcom0) — then
   tell the developer exactly what to do and give them as long as they need:
   - "Open a serial terminal to each board at 115200 8N1 — the nRF Connect Serial Terminal app, or
     \`tio <port> -b 115200\`:"
       - Peripheral (you'll TYPE here): <peripheral vcom0 port>
       - Central (you'll WATCH here):   <central vcom port>
   - Tell them the peripheral waits for DTR, so the terminal must actually open the port (most do by default).
   - Ask them to confirm once BOTH terminals are open. Do NOT start capturing or ask them to type until they
     say they are ready — give them time to figure out the serial terminal.

5. Buggy run: start an RTT capture on the peripheral (generous duration, ~30s) and ask the developer to type
   a short message (e.g. "hello") into the PERIPHERAL terminal. With the bug, the peripheral RTT logs
   "Failed to send data over BLE connection" and nothing arrives in the central terminal. Point both out.

6. Apply the fix to the /tmp central copy only — add \`bt_nus_subscribe_receive(nus);\` immediately after
   \`bt_nus_handles_assign(dm, nus);\` in \`discovery_complete()\` — then rebuild and reflash central by serial.
   Leave the developer's terminals open.

7. Fixed run: ask the developer to type another message into the PERIPHERAL terminal. Now it appears in the
   CENTRAL terminal, and a fresh peripheral RTT capture shows the "Failed to send" failures are gone. That
   round-trip — typed on one board, seen on the other — is the proof the fix works on real hardware. Then
   end the task with \`<!--TASK_COMPLETE-->\`.

All RTT/UART capture uses the real capture action (log_device) exactly as the capture guide specifies — do
NOT shell out to JLinkRTTLogger or similar. If any step fails, show the real error and stop — do not fall
back to ad-hoc workarounds.

If the developer picks "Just build it — no boards needed", prove the fix compiles without flashing. Work on a throwaway /tmp copy (this also avoids CMake's space-in-path bug):
   \`\`\`
   rm -rf /tmp/adsum_demo_central /tmp/adsum_demo_build && cp -R "${ws.centralPath}" /tmp/adsum_demo_central
   \`\`\`
In \`/tmp/adsum_demo_central/src/main.c\`, inside \`discovery_complete()\`, add \`bt_nus_subscribe_receive(nus);\` immediately after \`bt_nus_handles_assign(dm, nus);\`, then build from inside the NCS workspace:
   \`\`\`
   west build -s /tmp/adsum_demo_central -b nrf52840dk/nrf52840 -d /tmp/adsum_demo_build
   \`\`\`
On a clean build, tell the developer the fix compiles and \`bt_nus_subscribe_receive()\` is a real NCS API — the diagnosis was accurate. Then call attempt_completion and end with \`<!--TASK_COMPLETE-->\`.

${wrapUp}
`
	}

	return `
After your five-beat analysis and one-sentence verdict, present the next step as BUTTONS using the ask_followup_question tool (never as "type this" free text). Ask exactly this:

Question: "That's the bug — diagnosed entirely from the captured logs and the two firmware sources. Where to next?"
Options:
- "Show me the one-line fix"
- "I've seen enough — wrap up"

${askAnything}

If the developer picks "Show me the one-line fix": show the fix in context — in \`discovery_complete()\`, add \`bt_nus_subscribe_receive(nus);\` immediately after \`bt_nus_handles_assign(dm, nus);\` — and explain in one or two sentences why that single line restores the dropped peripheral->central path. Then call attempt_completion with a one-line conclusion and end the final message with \`<!--TASK_COMPLETE-->\`.

${wrapUp}
`
}

/** Recursively copy a directory. */
async function copyDir(src: string, dest: string): Promise<void> {
	await fs.mkdir(dest, { recursive: true })
	const entries = await fs.readdir(src, { withFileTypes: true })
	await Promise.all(
		entries.map(async (entry) => {
			const srcPath = path.join(src, entry.name)
			const destPath = path.join(dest, entry.name)
			if (entry.isDirectory()) {
				await copyDir(srcPath, destPath)
			} else {
				await fs.copyFile(srcPath, destPath)
			}
		}),
	)
}
