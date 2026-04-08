# Autonomous Debug Loop (workflows/debug-loop.md)

**Triggered by:** Log Generator Step 6, Log Analyzer recommendation, code modifications, or explicit user request to "build and flash".

The Debug Loop is an iterative process to **Build**, **Flash**, **Capture Logs**, and **Analyze** firmware until an issue is resolved. This workflow orchestrates the actions defined in `actions/`.

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

### Phase 1: Build

**MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/build.md` BEFORE proceeding. Do not attempt this action from memory. Execute the built action exactly as described.

- If **Ask Every Time** mode: use `ask_followup_question`:
  - Question: *"Ready to build `<project>` for `<board>`. Proceed?"*
  - Options: `["Build now", "Skip build", "Cancel task"]`
- If **Auto-Approve** mode: run the build directly.

On **build failure:** follow the error handling in `actions/build.md`. Do NOT silently retry with the same code.

### Phase 2: Flash

Only proceed if the build succeeded.

**MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/flash.md` BEFORE proceeding. Do not execute from memory.

- If **Ask Every Time** mode: use `ask_followup_question`:
  - Question: *"Build succeeded ✅. Flash to the connected device now?"*
  - Options: `["Flash now", "Skip flash", "Cancel task"]`
- If **Auto-Approve** mode: flash directly.

On **flash failure:** follow the error handling in `actions/flash.md`.

### Phase 3: Capture Logs

After a successful flash, determine if you should capture logs based on the active permission mode:

- If **Ask Every Time** mode: use `ask_followup_question`:
  - Question: *"Device flashed ✅. Capture logs now?"*
  - Options: `["Capture RTT logs", "Capture UART logs", "Skip — I'll check manually"]`
- If **Auto-Approve** mode: capture automatically (default to RTT if supported).

If capturing: **MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/capture-logs.md` BEFORE capturing logs. Assume nothing from memory.

### Phase 4: Analyze

After log capture, **MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/analyze-logs.md` BEFORE performing the analysis.

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
