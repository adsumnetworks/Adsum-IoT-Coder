# Autonomous Debug Loop

**Triggered by:** Log Generator Step 6, Log Analyzer, code modifications, or explicit user request to "build and flash".

The Debug Loop is an iterative process to **Build**, **Flash**, **Capture Logs**, and **Analyze** firmware until an issue is resolved. This workflow is SDK-agnostic and is tuned per-platform by the files in `platforms/<sdk>/`.

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

**For NCS/Zephyr projects:** Run `west build` in the nRF Connect Terminal (not the standard terminal).
- Whene a modification done in prj.conf or device tree you should run `west build -t pristine`.
- If the project has many builds folder you should specify the build folder and board using `west build -b <BOARD> -d <build_directory>`, otherwise if there is single board and single build just run `west build`.

- If **Ask Every Time** mode: use `ask_followup_question`:
  - Question: *"Ready to build `<project>` for `<board>`. Proceed?"*
  - Options: `["Build now", "Skip build", "Cancel task"]`
- If **Auto-Approve** mode: run the build directly.

On **build failure:**
- Display the error summary (not raw terminal output — extract the key error line).
- Use `ask_followup_question`:
  - Question: *"Build failed. How would you like to proceed?"*
  - Options: `["Attempt auto-fix", "Show me the full error", "Cancel"]`
- Do NOT silently retry with the same code.

### Phase 2: Flash

Only proceed if the build succeeded.

**For NCS/Zephyr projects:** Run `west flash` in the nRF Connect Terminal.
- To flash a specific build folder you should specify the build folder using `west flash -d <build_directory>`, otherwise if there is single build just run `west flash`.

- If **Ask Every Time** mode: use `ask_followup_question`:
  - Question: *"Build succeeded ✅. Flash to the connected device now?"*
  - Options: `["Flash now", "Skip flash", "Cancel task"]`
- If **Auto-Approve** mode: flash directly.

On **flash failure:**
- Use `ask_followup_question`:
  - Question: *"Flash failed. What would you like to do?"*
  - Options: `["Retry flash", "Check device connection", "Cancel"]`

### Phase 3: Capture Logs

After a successful flash, use `ask_followup_question`:
- Question: *"Device flashed ✅. Capture logs now?"*
- Options: `["Capture RTT logs", "Capture UART logs", "Skip — I'll check manually"]`

If capturing: use the appropriate device tool (do NOT expose internal tool names to the user). Log files should be named `<role>_<sn>_<timestamp>.log`.

### Phase 4: Analyze

After log capture, read the log file and check for:
- Hard faults or panics.
- Generic errors (`ERR`, `ASSERT`, `CRASH`).
- Protocol-specific issues (e.g., BLE "dropped" events, connection timeouts, ATT errors).
- Unexpected reboots or watchdog triggers.
- then show the summery of you analysis with the important log snippet, with the logs path so he can click and view the full log file.

Then use `ask_followup_question`:
- Question: *"Logs captured and analyzed. What would you like to see?"*
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
