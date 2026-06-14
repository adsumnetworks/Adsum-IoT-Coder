---
id: adsum/esp/workflows/debug-loop
title: "Autonomous Debug Loop"
type: workflow
version: 1.0.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: esp
triggers: ["build and flash", "debug my device", "why does it crash/reset"]
requires:
  - adsum/esp/actions/configure
  - adsum/nrf/actions/analyze-logs
  - adsum/nrf/actions/build
  - adsum/nrf/actions/capture-logs
  - adsum/nrf/actions/decode-fault
  - adsum/nrf/actions/flash
---

# Autonomous Debug Loop (workflows/debug-loop.md)

**Triggered by:** "build and flash", "debug my device", "why does it crash/reset", a code fix that needs verifying, or a handoff from another workflow.

The core iterative cycle: **Build → Flash → Capture → Analyze → Fix**, on real hardware. This Workflow orchestrates the Actions in `platforms/esp/actions/`.

---

## Step 0: Identify the hardware (first iteration only)
Before the first build, establish the target per `rules/device-identity.md`: read `sdkconfig` (`CONFIG_IDF_TARGET`, PSRAM, flash size), and identify the connected chip with `triggerEspAction` action="execute" command="`esptool.py flash_id`" (+ `idf.py --version`). Reconcile mismatches with the user. Do not skip — flashing the wrong target fails or boot-loops.

## Pre-Loop: Permission Mode
Use `ask_followup_question`:
- *"Ready to start the Build & Flash cycle. How should I handle permissions?"*
- Options: `["Ask me before each Build & Flash", "Auto-approve for this entire task"]`

Store it for the task: **Ask Every Time** → confirm before each Build and each Flash. **Auto-Approve** → proceed without interrupting (safety guards below still apply).

---

## Loop Phases

### Phase 1: Build
**MANDATORY SKILL LOAD:** if not already loaded this task, `read_file` `platforms/esp/actions/build.md` before proceeding.
- Ask Every Time → `ask_followup_question`: *"Build `<project>` for `<chip>`. Proceed?"* → `["Build now", "Skip build", "Cancel"]`.
- Auto-Approve → build directly.
- On failure: follow `build.md` error handling. Fix the root cause — never silently retry identical code.

### Phase 2: Flash
Only if the build succeeded. **MANDATORY SKILL LOAD:** `platforms/esp/actions/flash.md` (if not loaded).
- Ask Every Time → *"Build succeeded ✅. Flash to the connected board now?"* → `["Flash now", "Skip flash", "Cancel"]`.
- Auto-Approve → flash directly. On failure: follow `flash.md`.

### Phase 3: Capture Logs
After a successful flash. **MANDATORY SKILL LOAD:** `platforms/esp/actions/capture-logs.md` (if not loaded).
- Ask Every Time → *"Flashed ✅. Capture the serial log now?"* → `["Capture logs", "Skip — I'll check manually"]`.
- Auto-Approve → capture automatically (`action="monitor"`, default duration 10 s, reset before capture).
- Pick duration by goal (crash 10 s · Wi-Fi 20–30 s · stability 60 s+).

### Phase 4: Analyze
**MANDATORY SKILL LOAD:** `platforms/esp/actions/analyze-logs.md` (if not loaded).
- First `list_files` `logs/uart/` and pick the most recent file (timestamps — never guess).
- **If a panic / `Guru Meditation` backtrace appears:** **MANDATORY SKILL LOAD** `platforms/esp/actions/decode-fault.md` and resolve it to `file:line` before reporting (a raw register dump is not an analysis). `action="monitor"` usually decodes it already — read the first frame in the user's code.
- Produce the structured report inline, with decoded backtrace `file:line` / WDT task / reset cause and the clickable log path.
- Then `ask_followup_question` (not `attempt_completion`): *"Analyzed. What next?"* → options like `["Apply the fix and re-run", "Capture again (longer)", "Enable deeper logging", "Stop here"]`.

### Phase 5: Fix & Repeat
If a root cause is found: propose it, apply the fix, and return to **Phase 1** (same permission mode).
- **Code fix** → edit the source.
- **Config value** (Wi-Fi creds, pins, broker URL, stack size, flash/PSRAM, log level): **MANDATORY SKILL LOAD** `platforms/esp/actions/configure.md` and follow it — editing `sdkconfig.defaults` alone will NOT change an existing `sdkconfig` (the most common "my change did nothing" trap). Never invent credentials; ask the user.

---

## Safety Guards (Auto-Approve mode)
- **Max 5 full iterations** without resolution → stop and report.
- **Stuck-loop detection:** identical build error twice with no code change → stop immediately.
- **Halt & report** via `ask_followup_question`: *"I've tried `<N>` iterations without resolving it. What next?"* → `["Show a summary of attempts", "Try a different approach", "Stop and I'll investigate"]`.

## Handoff
- **Fixed** → `<!--TASK_COMPLETE-->`.
- **Board already running, no reflash wanted** (the user just wants logs read) → `workflows/log-analyzer.md`.
- **Logs too sparse to diagnose** → `workflows/log-generator.md`.
- **More code/features needed** → loop back to Phase 1.
