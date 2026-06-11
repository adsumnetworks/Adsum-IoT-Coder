import type { NrfEnvironment } from "@shared/nrf"
import fs from "fs/promises"
import * as path from "path"
import { ExtensionRegistryInfo } from "@/registry"

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
	const workflowFile = path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "workflows", "demo-debug.md")
	const bleFile = path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "sdks", "ncs", "protocols", "BLE.md")
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
		const flashDoc = path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "actions", "flash.md")
		const captureDoc = path.join(_extensionPath!, "iot-knowledge", "platforms", "nrf", "actions", "capture-logs.md")
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
