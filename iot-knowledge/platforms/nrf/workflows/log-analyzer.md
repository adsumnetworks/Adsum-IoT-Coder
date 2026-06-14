---
id: adsum/nrf/workflows/log-analyzer
title: "Log Analyzer Workflow"
type: workflow
version: 1.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: nrf
triggers: ["Analyze device logs", "Check logs", "What do the logs say", "I want to debug my device"]
requires:
  - adsum/nrf/actions/analyze-logs
  - adsum/nrf/actions/capture-logs
---

# Log Analyzer Workflow (workflows/log-analyzer.md)

**Triggered by:** Prompts like "Analyze device logs", "Check logs", "What do the logs say", "I want to debug my device"

This workflow intelligently matches connected devices to open projects, captures live logs, and provides root-cause analysis.

---

## Step 1: Silent Workspace Analysis

Read `environment_details` silently. For EACH workspace root:
- Identify the project by looking for `CMakeLists.txt`, `prj.conf`, and `src/`.
- Read `prj.conf` to detect:
  - **Log backend:** `CONFIG_USE_SEGGER_RTT=y` (RTT) or `CONFIG_LOG_BACKEND_UART=y` (UART). UART enabled by default so it is always enabled, only if it is set to =n.
  - **BLE role:** `CONFIG_BT_CENTRAL=y` or `CONFIG_BT_PERIPHERAL=y`.
- Scan for build dirs (any directory containing `build_info.yml`, e.g. `build/`, `build_52840/`) to get board names.

**Context budget:** Only check workspace roots from `environment_details`. Do NOT scan Desktop, home dir, or unrelated directories.

**Decision tree — based on what you found:**

**Case A — NCS project found:**
- Check for existing log files matching our naming pattern (`logs/rtt/*.log` or `logs/uart/*.log`).
- If matching logs exist → always ask with `ask_followup_question`:
  - If **< 5 minutes old**, note it: *"I found a recent log file ([time ago]). Analyzing it saves time and tokens. Capture fresh logs instead?"*
  - If **> 5 minutes old**: *"I found a log file from [time ago]. Capture fresh logs or analyze existing?"*
  - Options: `["Analyze existing log", "Capture fresh logs"]`
- If no matching logs → proceed to Step 2 (device discovery).

**Case B — No NCS project found:**
- Primary job is fresh capture. Proceed to Step 2 (device discovery).
- Before capturing, warn the user once: *"⚠️ No NCS project is open. I can capture and analyze logs, but without source code I can't cross-reference config or pinpoint the root cause. For full analysis, open your project folder."*
- Do NOT block. Proceed with capture.
- Do NOT search for random `.log` files on Desktop or home directories.

---

## Step 2: Device Discovery & Intelligent Matching

List connected devices using `nrfutil device list` and `nrfutil device device-info` in the nRF Connect Terminal (do NOT expose internal tool names).

**Intelligent Matching Rules (see `rules/device-identity.md`):**
- **SINGLE DEVICE:** If you have exactly one device connected AND project config has `CONFIG_BT_CENTRAL=y` (or `PERIPHERAL`), you can safely assume that device has that role.
- **MULTI-DEVICE WARNING:** If multiple devices are connected, you CANNOT know which serial number runs which firmware. You **MUST** label them **"Device 1"** and **"Device 2"** until logs confirm their identity. Do NOT map project roles to serial numbers by guessing.
- **NEVER** infer a role from the board type or SoC. An nRF52840 is NOT always a central.

**If device listing fails:** Use `ask_followup_question`:
- Question: *"I couldn't list connected devices. Please check USB connections."*
- Options: `["Retry", "Enter serial number manually", "Cancel"]`

- Be helpful and guide the user on how to check if the device is connected like: the DK LED shouldn't be blinking, check nRF Connect extension to see if the device is connected, try to unplug and replug the device, try a different USB port, try a different USB cable...etc

---

## Step 3: Proactive Proposal

After discovering devices, use `ask_followup_question` to propose the next step.
- **Example (Multi-Device):** *"I found your Central and Peripheral projects, and two connected devices. Since I don't know which board runs which firmware yet, I'll label them Device 1 and Device 2. Capture logs from both to confirm?"*
  - Options: `["Capture both (Device 1 & 2)", "Only Device 1", "Only Device 2"]`
- **Example (Single Device):** *"I found your Central project and one connected device. Capture logs now?"*
  - Options: `["Capture logs", "I already have logs"]`

---

## Step 4: Log Capture

For each selected device, ask about duration if not obvious from context:
- Use `ask_followup_question`:
  - Question: *"How long should I capture logs for?"*
  - Options: `["15 seconds (connection debug)", "5 seconds (crash/hardfault)", "60 seconds (stability test)", "Custom duration"]`

**MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/capture-logs.md` BEFORE capturing logs. Assume nothing from memory. Execute the capture action exactly as instructed.

---

## Step 5: Analysis (Code-Aware)

After capturing, **MANDATORY SKILL LOAD:** If not already loaded during this task, you MUST use the `read_file` tool to load `platforms/nrf/actions/analyze-logs.md` BEFORE reading or analyzing the log file. Follow its analysis patterns.

Go beyond surface-level observation — correlate every error with the actual source code and configuration when possible. If the project uses BLE, reference `sdks/ncs/protocols/BLE.md` for HCI disconnect codes and per-module log guidance.

---

## Step 6: Report — Expert Analysis Template

After analysis, you MUST produce an inline structured summary using the report template from `actions/analyze-logs.md`. 
**CRITICAL CHAT RULE:** You MUST output this HIGH-QUALITY, highly structured summary directly into the chat visible to the user. This is NOT a thought process; this is your professional report to the engineer. The summary MUST use the provided template: organized by system phases (Boot, Connection, Data Transfer, Errors), using bullet points, and crucially, MUST embed important log snippets alongside the bugs/issues. Do NOT provide a weak, conversational paragraph in the chat or hide it in `<thinking>`.

After the report, you MUST present the next steps. 
**CRITICAL:** Do NOT use the `attempt_completion` tool here. You are offering buttons, so you MUST use ONLY the `ask_followup_question` tool:

**Standard case:**
- Question: *"Analysis complete. What's next?"*
- Options: `["Generate detailed report (.md)", "Enable deeper logging", "Trigger another capture", "Done"]`
*(If the user selects "Done", you may then use `attempt_completion` to terminate the task.)*

**Sparse logs / no meaningful data:**
- Question: *"Logs are sparse — not enough data to diagnose. Would you like to add more logging to the firmware?"*
- Options: `["Yes, switch to Log Generator", "Capture again with longer duration", "No, I'll investigate manually"]`

---

## Workflow Handoff

Based on analysis result and user choice:
- **Build / Flash needed** — whether the analysis surfaced a bug to fix, or the user explicitly asks to flash/reflash, or the firmware was never flashed in the first place — hand off to the Debug Loop.
- **More logging needed** (sparse logs, need deeper BLE logs) — hand off to the Log Generator workflow.
- **Analysis complete, user satisfied** (e.g., they selected "Done") — use the `attempt_completion` tool to terminate. **Tip:** Include a summary of your final analysis in the `result` parameter for the user's records.
