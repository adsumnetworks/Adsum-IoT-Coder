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
 * Copy the read-only pre-built CRA reference bundle (design/34) to a WRITABLE location so the CVE scan can write
 * its artifacts (cve-scan-*.{md,json}) next to the SBOM and the report can be written into the run-folder. The
 * shipped bundle (`demo-scenarios/cra-prebuilt/<platform>`) is read-only in a published install. Re-copied each run.
 * Returns the writable bundle path (laid out like a build dir: `sbom/all.spdx`, `zephyr/{.config,symbols.nm,…}`).
 */
export async function prepareCraBundle(platform: "nrf" | "esp" = "nrf"): Promise<string> {
	if (!_extensionPath || !_globalStoragePath) {
		throw new Error("DemoManager not initialized — call initDemoManager() in activate()")
	}
	const version = ExtensionRegistryInfo.version
	const dest = path.join(_globalStoragePath, "demo", `cra-prebuilt-${platform}-${version}`)
	const src = path.join(_extensionPath, "demo-scenarios", "cra-prebuilt", platform)
	await copyDir(src, dest)
	return dest
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
		"Run CRA SBOM & Fix on a pre-built reference sample — a REAL SBOM + a live CVE scan + a secure-by-design " +
		"posture for the EU Cyber Resilience Act, on our nRF sample (a reference firmware, not your build)."
	)
}

/**
 * Prompt for the CRA Sample run (design/34): a REAL CRA analysis of a PRE-BUILT reference sample — no build on the
 * user's machine (the user almost never has the exact SDK our sample was built on, so we ship the build artifacts).
 * The SBOM is real (`west spdx`), the CVE scan is LIVE, the posture is from the real merged `.config` — nothing is
 * "simulated"; only the build was done ahead of time, by us. The host scan reads the bundle's shipped SBOM +
 * `.config` + `symbols.nm` + `version.h` (laid out like a build dir). It ALWAYS ends by offering the real run on the
 * user's own project. `bundlePath` is the WRITABLE copy from prepareCraBundle().
 */
function buildCraSamplePrompt(bundlePath: string): string {
	// cra-readiness is a DOWNLOADED (proprietary) bit — referenced by its bare k-bit path (resolver serves it from
	// ADSUM_KBIT_LOCAL in dev / the registry in prod). It carries the honesty rules + the Sample-run (pre-canned) mode.
	const workflowFile = "cra/workflows/cra-readiness.md"
	return `Run the CRA SBOM & Fix **Sample run** on our pre-built reference bundle at ${bundlePath}.

[ADSUM_DEMO:cra-sample] This is the SAMPLE run — a REAL CRA analysis of OUR pre-built nRF reference firmware \
(central_uart, NCS 3.2.1 / Zephyr 4.2.99), regardless of whether the user has a project open. It is NOT "simulated": \
the SBOM is a real \`west spdx\` build, the CVE scan is LIVE, the posture is the real merged .config. The ONLY thing \
not happening on the user's machine is the build — we pre-built it (the user almost never has our exact SDK). The one \
honest caveat: this describes OUR reference firmware, NOT the user's build.

Hard rules for this Sample run:
- Load and follow the workflow's **Sample-run (pre-canned) mode**: read_file ${workflowFile}. **If that read fails, \
STOP: tell the developer the CRA workflow is currently unavailable and do NOT proceed. Never reconstruct the \
workflow or template the report from memory or a prior run.** It carries the honesty rules (evidence-mode only; NO \
verdicts/grades/scores; the "# CRA SBOM & Fix — central_uart (reference sample)" title + "Readiness aid — NOT a \
conformity assessment" disclaimer; curated Annex Part I/Part II + Article 14 citations only).
- **Use the workflow's standard FIVE plain-English task_progress phases** (Inventory your build · Scan for known CVEs \
· Read the security posture · Triage what affects you · One concrete next step) — do NOT turn these internal \
mechanics (load workflow / scan the SBOM / write the report) into the checklist.
- **No build, no SBOM generation.** Trigger the host CVE scan directly on the pre-canned bundle: \
triggerCveScan with sbom=${bundlePath}/sbom/all.spdx and build=${bundlePath} (the bundle ships the merged \
.config, the symbol dump, and the SDK version, so applicability + posture + version-fixed all run with no toolchain). \
For the posture, grep ${bundlePath}/zephyr/.config for the posture symbols (per the posture bit) — do not build.
- **Label it a REFERENCE sample (not "simulated"):** the report Method is "pre-built reference SBOM"; the headline \
says plainly this is a real analysis of OUR reference firmware (NCS 3.2.1 / Zephyr 4.2.99, captured 2026-06-29), \
NOT the user's build. The "components" count is the SBOM total (~180), not the queryable count.
- Write the report to an OS-temp scratch compliance/cra-<date>/CRA_READINESS.md via write_to_file FIRST (the host \
honesty guard runs there), then present a THIN headline (at-a-glance counts + the top finding + the written path). \
Do NOT re-render the posture/CVE tables in chat.
- **ALWAYS end with the real-run CTA** (ask_followup_question): "Want this on YOUR firmware? Open your project \
(File ▸ Open Folder — VS Code reloads), then click CRA SBOM & Fix — I'll build on your SDK, generate a live SBOM, \
and run the full CRA process on your real build." Offer to save a copy of this sample report to the user's Desktop. \
Do NOT call attempt_completion before offering the CTA.`
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

/**
 * Open NOTHING at launch — a clean entry like the NUS Sample run. The agent narrates and reads the real per-layer
 * captures on-demand as it reaches each beat; auto-opening a file spoils the reveal and reads as a raw dump.
 * (Param kept for the scenario-registry signature; intentionally unused.)
 */
export function hciSnifferOpenInEditor(_bundleRoot: string): string[] {
	return []
}

/**
 * Thin orchestrator for the HCI + Sniffer Sample run. The screenplay (beats, diagrams, the verified signatures, the
 * honesty + no-spoiler rules) lives in the DOWNLOADED bit nrf/workflows/demo-debug-hci.md (referenced by bare relpath,
 * like cra-sample references cra-readiness). This host prompt only sets up the bench, the real capture/source paths,
 * the capability-gated buttons, and the seamless CRA closing. `craBundleRoot` is the writable cra-prebuilt/nrf bundle
 * (prepared by the registry) used by the "ship-ready" branch.
 */
export function buildHciSnifferPrompt(
	bundleRoot: string,
	capability: DemoCapability,
	env?: NrfEnvironment,
	craBundleRoot?: string,
): string {
	const log = (tier: "buggy" | "fixed", name: string) => path.join(bundleRoot, "logs", tier, name)
	const appLog = log("buggy", "app.log")
	const hciBuggy = log("buggy", "hci.hci.log")
	const hciFixed = log("fixed", "hci.hci.log")
	const snifferFixed = log("fixed", "sniffer.sniffer.log")
	const centralSrc = path.join(bundleRoot, "central_uart", "src", "main.c")
	const rawSniffer = log("buggy", "sniffer.sniffer.log")
	const pcap = log("buggy", "sniffer.pcap")
	const workflowBit = "nrf/workflows/demo-debug-hci.md" // downloaded bit → bare relpath (NOT resolveBitPathSync)
	const craWorkflow = "cra/workflows/cra-readiness.md"
	const craSbom = craBundleRoot ? `${craBundleRoot}/sbom/all.spdx` : "<cra-bundle>/sbom/all.spdx"
	const craBuild = craBundleRoot ?? "<cra-bundle>"
	const dkCount = env?.boards?.length ?? 0

	return `Demo: HCI + Sniffer — a real BLE bug across three layers (no setup needed)

[ADSUM_DEMO:hci-sniffer] You are running Adsum's flagship 3-layer BLE deep-observability Sample run for a developer EVALUATING the tool. The full screenplay — the beats, the diagrams, the verified signatures, the honesty rules, the no-spoiler discipline — lives in the workflow bit. Read it FIRST and FOLLOW it; this message only sets up the bench, the real file paths, and the close.

=== LOAD THE WORKFLOW (do this first) ===
read_file ${workflowBit} — the HCI + Sniffer screenplay. If that read FAILS, STOP: tell the developer the demo workflow is currently unavailable and do NOT proceed (never reconstruct the beats or the numbers from memory).

=== THE REAL CAPTURES — read the ONE file named at each beat; never dump them all ===
- App layer (central RTT):        ${appLog}
- HCI bus, buggy:                 ${hciBuggy}
- Central source (the bug):       ${centralSrc}
- HCI bus, fixed (the proof):     ${hciFixed}
- Over the air, fixed (sniffer):  ${snifferFixed}
(Full raw captures for "open in Wireshark" only — never ingest: ${rawSniffer} · ${pcap}, + the fixed/ equivalents.)

=== STEP 1 — needs-led open + scan the bench (first message, keep it tight) ===
- Open with the bit's credible hook (the bug hides below your code; it's readable across three layers — the app log, the HCI bus, and the air) and render the bit's 3-layer stack mermaid. No hype.
- Lead with WHAT LIVE NEEDS, then offer the choice (do not just report what's missing):
  • Captured walkthrough — replay the real capture, layer by layer (no setup).
  • Live on your bench — 1 nRF DK → live HCI; 2 DKs → both sides + build/flash the fix; + an nRF52840 Dongle → the over-the-air sniffer.
- THEN scan, so they see you read the bench: triggerNordicAction action="log_device", operation="list". A DK = PCA10056/PCA10095/PCA10040 (J-Link); a sniffer dongle = "nRF Sniffer for Bluetooth LE" (flashed) or "Open DFU Bootloader"/PCA10059 (unflashed) — NEVER reported as a DK. In ONE line report what's connected (or none). (Host hint: capability=${capability}, DKs detected=${dkCount}.)
- Ask with buttons — include ONLY what the hardware supports; the captured walkthrough is ALWAYS offered:
  ask_followup_question — "How do you want to see it?"
    - "Walk me through the capture"        ← ALWAYS include
    - "Capture it live on my board"        ← include if you scanned ≥1 DK
    - "Capture live + sniff over the air"  ← include ONLY if you scanned a DK AND a sniffer dongle

=== STEP 2 — the walkthrough (follow the bit's staged beats EXACTLY) ===
Read the ONE real capture named at each beat (paths above), one layer at a time, ending EVERY beat with an ask_followup_question button (always include a "Skip to the fix" / "Seen enough" escape):
  Beat 1 App — read ${appLog}            → button "Tap the HCI bus →"
  Beat 2 HCI buggy — read ${hciBuggy}    → button "Show me the missing code →"
  Beat 3 reveal + source — read ${centralSrc}, then Beat 4 the fix → button "Prove it on the HCI bus →"
  Beat 5 HCI proof — read ${hciFixed}    → button "Sniff the air →"
  Beat 6 sniffer — read ${snifferFixed}  → THE CLOSING
Honor the bit's no-spoiler rule (do NOT name bt_nus_subscribe_receive() before Beat 3) and its honesty rules — the buggy air capture is advertising-only, so NEVER show a fabricated buggy↔fixed air delta; the real air diff is the live OTA tier.
If they picked a LIVE option, follow the bit's Live tiers section instead (load nrf/actions/flash, nrf/actions/capture-logs, nrf/workflows/hci-trace, and — for OTA — nrf/workflows/ble-sniffer), with the bit's graceful-degradation rule.

=== THE CLOSING — unrushed, then the seamless CRA bridge (every path ends here) ===
Lead with the win (per the bit), then offer — never push CRA onto the demo firmware:
  ask_followup_question — "Where to next?"
    - "See if a build like this is ship-ready"
    - "Run this on my own nRF project"
    - "Wrap up"
- If "ship-ready": run the CRA SBOM & Fix Sample INLINE on the SAME central_uart reference. read_file ${craWorkflow} (its Sample-run mode; if that read FAILS, STOP and say CRA is unavailable — never reconstruct it). Then triggerCveScan with sbom=${craSbom} and build=${craBuild}. Follow cra-readiness's Sample-run mode (the 5 plain-English phases; the "# CRA SBOM & Fix — central_uart (reference sample)" title + the "readiness aid — NOT a conformity assessment" disclaimer; write the report, then present a THIN headline), and END with its real-run CTA ("Want this on YOUR firmware? Open your project…").
- If "Run this on my own nRF project": invite File ▸ Open Folder, then CRA SBOM & Fix / debug on their real build.
- If "Wrap up": a two-sentence recap (root cause + the one-line fix); if NO hardware was detected, add one nudge to connect a DK (or two) + an nRF52840 Dongle to do all three layers live next time.

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
			// design/34: the Sample run scans a PRE-CANNED reference bundle (no build), copied to a writable location.
			const bundlePath = await prepareCraBundle("nrf")
			return { taskText: buildCraSamplePrompt(bundlePath), displayText: buildCraSampleDisplayText() }
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
			// Stage the CRA reference (same central_uart firmware) so the "ship-ready" close can run the CRA
			// SBOM & Fix Sample inline, in this same task — no toolchain/hardware needed (pre-built SBOM + .config).
			const craBundleRoot = await prepareCraBundle("nrf")
			const capability = classifyDemoCapability(env)
			return {
				taskText: buildHciSnifferPrompt(bundleRoot, capability, env, craBundleRoot),
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

/** Recover a demo scenario id from a task's chat-bubble text (the displayText we set at launch). Used at
 *  attempt_completion to attribute `demo_run_completed` to the RIGHT scenario — not just nus-uart. Each
 *  displayText headline is the stable prefix the webview's `historyMatch` also keys on, so a startsWith match
 *  is exact. Returns undefined when the text isn't a demo bubble. */
export function detectDemoScenarioId(text: string): string | undefined {
	if (!text) {
		return undefined
	}
	const heads: Array<[string, string]> = [
		[SCENARIO_ID, buildDemoDisplayText()],
		["cra-sample", buildCraSampleDisplayText()],
		["esp-wifi", buildEspWifiDisplayText()],
		["hci-sniffer", buildHciSnifferDisplayText()],
	]
	for (const [id, display] of heads) {
		const head = display.split("\n")[0].trim()
		if (head && text.startsWith(head)) {
			return id
		}
	}
	return undefined
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
work on a throwaway copy in a path with NO SPACES so the demo stays pristine for the next run and CMake's space-in-path bug
never bites. Use whatever copy/remove commands match the shell you're actually running in (PowerShell on Windows, sh/bash
elsewhere) — pick a scratch directory outside globalStorage (e.g. your OS temp dir) and never symlink:

1. Copy the central project to that clean, space-free build location (remove any stale copy first).
2. Apply the fix in the COPY only. In the copy's \`src/main.c\`, inside \`discovery_complete()\`, add this line immediately after \`bt_nus_handles_assign(dm, nus);\`:
   \`\`\`c
   bt_nus_subscribe_receive(nus);
   \`\`\`
   (The demo source you analyzed is the buggy version and is missing this line — that is expected. Add it to the copy.)
3. Resolve the west board target yourself the same way you would for a real project — it does NOT have to be a specific board; pick any target you can build for (e.g. \`nrf52840dk/nrf52840\` if that's what's available) — then run \`west build -b <the target you resolved>\` from inside the NCS workspace against the copy's source dir (build dir alongside it).
4. If it compiles clean: tell the developer "The fix compiles on NCS ${sdkVersion}. \`bt_nus_subscribe_receive()\` is a real SDK API — the diagnosis was accurate. Connect two boards to see it run live." Then end the task with \`<!--TASK_COMPLETE-->\`.
5. If it fails: show the compiler error verbatim and explain what it means. Then end the task with \`<!--TASK_COMPLETE-->\`.

${wrapUp}
`
	}

	if (capability === "hardware") {
		const boardCount = env?.boards?.length ?? 1
		const boardWord = boardCount >= 2 ? `${boardCount} boards` : "a board"
		const boardList = env?.boards?.length
			? env.boards.map((b) => b.boardVersion ?? "unknown board").join(", ")
			: "your connected DK"
		const flashDoc =
			resolveBitPathSync("adsum/nrf/actions/flash") ??
			path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "actions", "flash.md")
		const captureDoc =
			resolveBitPathSync("adsum/nrf/actions/capture-logs") ??
			path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "actions", "capture-logs.md")
		return `
After your five-beat analysis and one-sentence verdict, present the next step as BUTTONS using the ask_followup_question tool (never as "type this" free text). Ask exactly this:

Question: "That's the bug. Want to see it fail and then pass on your own hardware? You have ${boardWord} connected (${boardList}) — I can flash the buggy firmware, capture real RTT, reproduce the failure, then apply the fix and confirm it end-to-end."
Options:
- "Flash & run it live on my boards"
- "Just build it — no boards needed"
- "I've seen enough — wrap up"

${askAnything}

If the developer picks "Flash & run it live on my boards", reproduce it live using the project's REAL flash and capture actions — do NOT
improvise with raw shell for flashing or capture, and do NOT hand-roll RTT capture. Read and follow these two action guides first:
- Flash:   ${flashDoc}
- Capture: ${captureDoc}

Then do the following in order. The product is Windows-first, so use whatever shell you're actually running in (PowerShell on
Windows, sh/bash elsewhere) for any copy/remove/process-kill step — never assume POSIX:

1. Process cleanup, then list devices to identify the two connected DKs and their serial numbers (per the flash guide — use
   the platform-appropriate kill command, e.g. \`taskkill\` on Windows, \`pkill\` elsewhere):
   \`\`\`
   nrfutil device list
   \`\`\`
   Confirm each device's family/board with \`nrfutil device device-info --serial-number <SN>\` (cross-check against
   \`boardVersion\` from the in-app scan, e.g. PCA10056 / PCA10095 / PCA10040) before flashing it. Assign roles yourself —
   one DK runs central_uart, the other runs peripheral_uart — do not guess which serial is which.

2. Resolve each DK's correct west board target yourself from its board version, exactly as you would for a real user
   project (e.g. PCA10056 → \`nrf52840dk/nrf52840\`, PCA10095 → \`nrf5340dk/nrf5340/cpuapp\`, PCA10040 → \`nrf52dk/nrf52832\`) —
   do NOT assume a fixed pair of boards.

3. Build BOTH projects (buggy, unfixed) from COPIES in a path with NO SPACES — this dodges CMake's space-in-path bug.
   Never build in place inside globalStorage, and never symlink. Copy \`${ws.centralPath}\` and \`${ws.peripheralPath}\`
   to a scratch location outside globalStorage (e.g. your OS temp dir), removing any stale copy first, then run
   \`west build\` against each copy with the board target you resolved in step 2, writing each build output alongside
   its copy.

4. Flash each board by serial (per the flash guide — always target the specific device with \`--dev-id <serial>\` so the
   right board gets the right image):
   \`\`\`
   west flash -d <central build dir>    --dev-id <central_sn>
   west flash -d <peripheral build dir> --dev-id <peripheral_sn>
   \`\`\`
   If a flash fails with a QSPI / SPIM external-flash error (common on the nRF52840DK's default runner), retry that
   board with \`--runner jlink\` added (the flash guide covers this); add \`--erase\` if a board still runs a stale image.

5. Set up the live proof — this is hands-on for the developer, so teach them first and WAIT. The broken
   direction (peripheral -> central) only happens when the peripheral has UART input to forward, and the
   central does NOT log received data (it forwards it to its own UART). So the proof is what the developer
   SEES in two serial terminals, backed by the peripheral's RTT. From the device list, identify each board's
   application UART — the central's VCOM, and the peripheral's FIRST VCOM (vcom0) — then
   tell the developer exactly what to do and give them as long as they need:
   - "Open a serial terminal to each board at 115200 8N1 — the nRF Connect Serial Terminal app, or
     a terminal tool of your choice:"
       - Peripheral (you'll TYPE here): <peripheral vcom0 port>
       - Central (you'll WATCH here):   <central vcom port>
   - Tell them the peripheral waits for DTR, so the terminal must actually open the port (most do by default).
   - Ask them to confirm once BOTH terminals are open. Do NOT start capturing or ask them to type until they
     say they are ready — give them time to figure out the serial terminal.

6. Buggy run: start an RTT capture on the peripheral (generous duration, ~30s) and ask the developer to type
   a short message (e.g. "hello") into the PERIPHERAL terminal. With the bug, the peripheral RTT logs
   "Failed to send data over BLE connection" and nothing arrives in the central terminal. Point both out.

7. Apply the fix to the central COPY only — add \`bt_nus_subscribe_receive(nus);\` immediately after
   \`bt_nus_handles_assign(dm, nus);\` in \`discovery_complete()\` — then rebuild and reflash central by serial.
   Leave the developer's terminals open.

8. Fixed run: ask the developer to type another message into the PERIPHERAL terminal. Now it appears in the
   CENTRAL terminal, and a fresh peripheral RTT capture shows the "Failed to send" failures are gone. That
   round-trip — typed on one board, seen on the other — is the proof the fix works on real hardware. Then
   end the task with \`<!--TASK_COMPLETE-->\`.

All RTT/UART capture uses the real capture action (log_device) exactly as the capture guide specifies — do
NOT shell out to JLinkRTTLogger or similar. If any step fails, show the real error and stop — do not fall
back to ad-hoc workarounds.

If the developer picks "Just build it — no boards needed", prove the fix compiles without flashing. Work on a throwaway
copy in a path with NO SPACES (this also avoids CMake's space-in-path bug), using the copy/remove command for whatever
shell you're running in — never assume POSIX. Copy \`${ws.centralPath}\` to that scratch location, removing any stale
copy first.
In the copy's \`src/main.c\`, inside \`discovery_complete()\`, add \`bt_nus_subscribe_receive(nus);\` immediately after \`bt_nus_handles_assign(dm, nus);\`, then resolve a west board target yourself (any target you can build for — it doesn't need to match the connected boards) and run \`west build -b <that target>\` from inside the NCS workspace against the copy.
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
