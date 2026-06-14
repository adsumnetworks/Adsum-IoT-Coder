---
id: adsum/nrf/workflows/debug-loop
title: "Autonomous Debug Loop"
type: workflow
version: 1.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: nrf
triggers: ["build and flash", "Build, flash & debug"]
requires:
  - adsum/nrf/actions/analyze-logs
  - adsum/nrf/actions/build
  - adsum/nrf/actions/capture-logs
  - adsum/nrf/actions/decode-fault
  - adsum/nrf/actions/flash
---

# Autonomous Debug Loop (workflows/debug-loop.md)

**Triggered by:** Log Generator Step 6, Log Analyzer recommendation, code modifications, or explicit user request to "build and flash". This is also the workflow behind the **"Build, flash & debug"** home card.

The Debug Loop is an iterative process to **Build**, **Flash**, **Capture Logs**, and **Analyze** firmware until an issue is resolved. This workflow orchestrates the actions defined in `actions/`.

---

## Step 0: Entry — (re)flash, or is the firmware already running?

Many "debug my device" requests are about a board that is **already running** the firmware — there,
rebuilding and reflashing is wasted effort (and risk). Settle this one thing before the loop.

**Skip the question when the answer is obvious:**
- You just made a code change, or the user explicitly said "build and flash" / "build, flash & debug"
  → go straight to the loop (Pre-Loop below).
- The user said "my device is misbehaving" / "check the logs" / "what do the logs say" with **no code
  change** → default to the analyze-only path.

Otherwise ask with `ask_followup_question`:
- Question: *"Is the firmware you want to debug already running on the board, or should I build & flash it first?"*
- Options: `["It's already running — just capture & analyze logs", "Build & flash first, then debug"]`

**Routing:**
- **Already running → analyze only (no reflash):** **MANDATORY SKILL LOAD:** `read_file` →
  `platforms/nrf/workflows/log-analyzer.md` and follow it — it owns device discovery, backend
  detection (RTT/UART), capture, and code-aware root-cause for a board you did **not** just flash
  (debug-loop's own capture phase assumes the device it flashed; log-analyzer does the discovery).
  Come back to the loop only if its analysis surfaces a fix to build & flash.
- **Build & flash first:** continue to Pre-Loop below.

---

## Pre-Loop: Permission Mode

Before the first iteration, use `ask_followup_question` to establish the permission mode:
- Question: *"Ready to start the Build & Flash cycle. How should I handle permissions?"*
- Options: `["Ask me before each Build & Flash", "Auto-approve for this entire task"]`

Store the user's selection for the duration of the task:
- **Ask Every Time** → Request approval before each individual Build and each individual Flash.
- **Auto-Approve** → Build and Flash as needed without interrupting the user.

---

## Loop Phases

> **An iteration ends at Phase 4 (Analyze) — never at Flash.** A successful flash only proves the
> image transferred, not that the firmware works. After every flash, continue to Capture and then
> Analyze unless the user explicitly opts out via the Phase 3 buttons. Ending the task right after
> a flash is an unfinished loop — the user came here to see the firmware *running*.

### Phase 1: Build

**MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/build.md` BEFORE proceeding. Do not attempt this action from memory. Execute the built action exactly as described.

- **Ask Every Time** → `ask_followup_question`: *"Ready to build `<project>` for `<board>`. Proceed?"* — Options: `["Build now", "Skip build", "Cancel task"]`
- **Auto-Approve** → run the build directly.

On **build failure:** treat it as a first-class diagnosis, not a blocker to "real" debugging — for
most everyday issues (Kconfig typo, missing overlay symbol, overflow), **the build error IS the
bug**. Go straight into `actions/build.md`'s error-handling table (key-line extraction + pattern
match), propose the fix, and loop — do NOT ask the user to "fix the build first and come back to
debug." Do NOT silently retry with the same code.

### Phase 2: Flash

Only proceed if the build succeeded.

**MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/flash.md` BEFORE proceeding. Do not execute from memory.

- **Ask Every Time** → `ask_followup_question`: *"Build succeeded ✅. Flash to the connected device now?"* — Options: `["Flash now", "Skip flash", "Cancel task"]`
- **Auto-Approve** → flash directly.

On **flash failure:** follow the error handling in `actions/flash.md`.

### Phase 3: Capture Logs

After a successful flash, capture is the default continuation — only the confirmation style depends on the permission mode:

- **Ask Every Time** → `ask_followup_question`: *"Device flashed ✅. Capture logs now?"* — Options: `["Capture RTT logs", "Capture UART logs", "Skip — I'll check manually"]`
- **Auto-Approve** → capture automatically (default to RTT if supported).

If capturing: **MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/capture-logs.md` BEFORE capturing logs. Assume nothing from memory.

**Naming reminder:** Follow `rules/device-identity.md` — use generic labels (`device1`, `device2`) if roles are unconfirmed. See `capture-logs.md` for the full naming convention.

### Phase 4: Analyze

After log capture, **MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/analyze-logs.md` BEFORE performing the analysis.

**Before reading the log file:** use `list_files` on the relevant `logs/<transport>/` directory to discover the actual captured filename. Filenames include timestamps; never guess them from the capture command output. Pick the most recently created file matching the device/transport that was just captured.

**If the log contains a fault signature** (`>>> ZEPHYR FATAL ERROR`, `***** USAGE/BUS/MPU/HARD FAULT *****`, `Stack overflow`, `SecureFault` — see `actions/decode-fault.md` for the full list): **MANDATORY SKILL LOAD** — `read_file` `platforms/nrf/actions/decode-fault.md` and decode the PC/LR to `file:line` before reporting. A raw register dump is not an analysis.

Show the summary of your analysis with the important log snippets and the log file path so the user can click and view the full file.

Then use `ask_followup_question`:
- Question: *"Logs captured and analyzed. What would you like to do?"*
- Options: should be flexible depending on the case: `["Generate a detailed analysis report", "Enable deeper BLE logs and analyze again", "Cancel and wait for your instructions"]`

### Phase 5: Fix & Repeat

If errors are found:
- Propose the fix.
- Apply the fix to the source code.
- Return to **Phase 1** (respecting the permission mode already set).

---

## Safety Guards

If running in **Auto-Approve** mode, apply these hard limits:

- **Max Retries:** Stop after **5 full iterations** if the issue is not resolved.
- **Stuck Loop Detection:** If the same build error persists across 2 consecutive loops with no code change, stop immediately.
- **Halt & Report:** Use `ask_followup_question` when halting:
  - Question: *"I've tried `<N>` iterations without resolving the issue. What would you like to do?"*
  - Options: `["Show me a summary of all attempts", "Try a different approach", "Stop and I'll investigate"]`

---

## Workflow Handoff

After the loop resolves or the user exits:
- **Bug fixed:** `<!--TASK_COMPLETE-->`
- **More code changes needed:** Loop back to Phase 1
- **Better logs needed:** Invoke `workflows/log-generator.md`
- **Deeper analysis needed:** Invoke `workflows/log-analyzer.md`
