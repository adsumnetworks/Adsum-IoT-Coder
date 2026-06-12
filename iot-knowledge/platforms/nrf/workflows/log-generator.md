---
id: adsum/nrf/workflows/log-generator
title: "Log Generator Workflow"
type: workflow
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
triggers: ["Generate logging code", "Add logs", "Add LOG macros", "Help me debug with logs"]
requires:
  - adsum/nrf/actions/capture-logs
---

# Log Generator Workflow (workflows/log-generator.md)

**Purpose:** Better logs = better analysis. This workflow's primary goal is to instrument your firmware so the Log Analyzer can perform meaningful root-cause analysis. Aim for logs that answer: boot sequence status, hardware init results, connection events, error states, and data flow. Without good logging, analysis is guesswork.

**Triggered by:** Prompts like "Generate logging code", "Add logs", "Add LOG macros", "Help me debug with logs"

This workflow adds NCS-compliant Zephyr logging (`LOG_*` macros) to C source files and configures `prj.conf`.

---

## Step 1: Silent Workspace Analysis

Read `environment_details` (provided automatically). For EACH VS Code workspace root listed:
- Check for `CMakeLists.txt`, `prj.conf`, and `src/` to confirm it is a valid nRF project.
- Check for all `**/build_info.yml` (e.g `build/build_info.yml`) to identify the existing builds board (e.g., `nrf52840dk`).
- Check connected devices with `nrfutil device device-info` to get serial numbers, Ports, device type, etc. of all connected devices.
- If there is a conflict between the existing builds board and the connected devices board ask the user which board to use, so that the generated logs will be tuned to the correct board.
- Read `prj.conf` to detect the current log backend: `CONFIG_LOG_BACKEND_UART=y` or `CONFIG_LOG_BACKEND_RTT=y`.

Do NOT ask questions during this step (except the board conflict question). Gather all context silently.

**No project found → STOP.** If no workspace root has `CMakeLists.txt` + `prj.conf` + `src/`, use `ask_followup_question`:
- *"I can't find an nRF Connect SDK project in the current workspace. Please open your project folder in VS Code first."*
- Options: `["I'll open my project now", "Help me find my project"]`
Do NOT proceed to Step 2.

---

## Step 2: Decision Point — Single vs Multi-Project

**IF SINGLE PROJECT:**
- Report briefly: *"Found project `<name>` (board: `<board>`) at `<path>`."*
- Immediately proceed to Step 3 (Code Injection). Do NOT ask for confirmation.

**IF MULTIPLE PROJECTS:**
- Report briefly: *"Found `<ProjectA>` (`<boardA>`) and `<ProjectB>` (`<boardB>`)."*
- Use `ask_followup_question` with buttons:
  - Question: *"Which project(s) should I add logging to?"*
  - Options: `["Add to all projects", "Only <ProjectA>", "Only <ProjectB>"]`
- Wait for the user's button selection before proceeding.

---

## Step 3: Code Injection

For each selected project:
1. Add `#include <zephyr/logging/log.h>` at the top of the relevant `.c` file(s).
2. Add `LOG_MODULE_REGISTER(<module_name>, LOG_LEVEL_DBG);` after the includes.
3. Inject `LOG_INF`, `LOG_DBG`, `LOG_WRN`, `LOG_ERR` macros at strategic locations:
   - Function entry/exit points for key subsystems.
   - Before and after hardware initialization calls.
   - BLE event callbacks (if applicable).
   - Error handling branches.

**Constraint:** Apply the code directly. Do not write a markdown plan about what you are going to do — just do it.

---

## Step 4: Post-Generation — RTT Check (Required)

After code injection, check `prj.conf` for the log backend:

**IF UART backend (`CONFIG_LOG_BACKEND_UART=y` or no RTT config found):**
Use `ask_followup_question`:
- Question: *"Logging injected ✅. You're currently using UART. For embedded/BLE projects, J-Link RTT is recommended — it's faster and doesn't interfere with wireless protocols. Switch to RTT?"*
- Options: `["Enable RTT in prj.conf", "Keep UART logging"]`

If user selects "Enable RTT": update `prj.conf` to add:
```ini
CONFIG_USE_SEGGER_RTT=y
CONFIG_LOG_BACKEND_RTT=y
# CONFIG_LOG_BACKEND_UART is not needed with RTT
```

**IF RTT already configured:** Skip this step and continue to Step 5.

---

## Step 5: Post-Generation — BLE Stack Check (Optional)

If the project contains BLE (`CONFIG_BT=y` in `prj.conf`), use `ask_followup_question`:
- Question: *"Would you like deeper BLE stack logs (connection events, GATT, security)?"*
- Options: `["Yes, enable BLE stack logs", "No, current logs are enough", "Check the logs first"]`

If user selects "Yes": refer to `sdks/ncs/protocols/BLE.md` for the per-module log level quick reference table. Enable only the Kconfig options matching the user's current debugging scenario — do NOT enable all BLE logs at once.

**CRITICAL — RTT Drop Prevention:**
When enabling deep BLE stack logging, you MUST apply the RTT buffer expansion properties defined in `sdks/ncs/protocols/BLE.md` (under "Deep Stack Logging — RTT Drop Prevention"). Failure to do so will result in dropped log messages.

---

## Step 6: Build & Flash

After all code changes are applied, you must offer the next steps. 
**CRITICAL:** Do NOT use the `attempt_completion` tool here. You are offering buttons, so you MUST use ONLY the `ask_followup_question` tool:

- Question: *"Code is ready. How would you like to proceed with Build & Flash?"*
- Options: `["Build & Flash now (ask me each time)", "Build & Flash autonomously for this task", "I'll do it manually"]`

- If user selects "Build & Flash": start the Debug Loop in **Ask Every Time** mode.
- If user selects "Build & Flash autonomously": start the Debug Loop in **Auto-Approve** mode.
- If user selects manually: you may now terminate the workflow using the `attempt_completion` tool.

---

## Workflow Handoff — Verification Capture

After the debug-loop completes a successful Build & Flash:

### Permission
Use `ask_followup_question`:
- Question: *"Code flashed. Shall I capture a 15-second verification log to ensure logging works?"*
- Options: `["Capture verification logs", "Skip verification"]`

If user selects "Skip verification": terminate using `attempt_completion`.

### Capture

**MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/capture-logs.md` BEFORE capturing. Do not proceed without it — the naming convention and capture parameters are defined there.

Capture a 15-second verification log following the instructions in `capture-logs.md`.

### Verify & Next Steps
Check that `LOG_MODULE_REGISTER` output appears in the captured logs.

- **If logs verified:** Use `ask_followup_question`: *"Logging is working. Would you like a full log analysis?"* → Options: `["Yes, start Log Analyzer", "No, I'm done"]`. (If user says "No", terminate using `attempt_completion`).
- **If logs missing:** Re-examine the code injection — the `LOG_MODULE_REGISTER` call may be missing or the module name may be wrong. Fix and re-flash.
