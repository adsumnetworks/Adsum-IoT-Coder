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

**Existing Log File Check:**
- Check if a log file already exists in the project (e.g. `logs/`, `*.log` in the workspace).
- If a log file exists:
  - Check its modification time.
  - If modified **less than 5 minutes ago** → proceed to Step 5 directly and analyze it (it is fresh).
  - If modified **more than 5 minutes ago** → prompt the user before proceeding:
    - Question: *"I found a log file from [time ago]. Should I analyze it, or capture fresh logs from the connected device?"*
    - Options: `["Analyze existing log", "Capture fresh logs", "Capture fresh + analyze code"]`
- If no log file exists → proceed to Step 2 (device discovery) to capture new logs.

Do NOT list devices or ask questions yet (unless the stale log prompt above is triggered).

---

## Step 2: Device Discovery & Intelligent Matching

List connected devices using `nrfutil device list` and `nrfutil device device-info` in the nRF Connect Terminal (do NOT expose internal tool names).

**Intelligent Matching Rules:**
- If project name contains `central` OR config has `CONFIG_BT_CENTRAL=y` → refer to that device as **"Central"**.
- If project name contains `peripheral` OR config has `CONFIG_BT_PERIPHERAL=y` → refer to that device as **"Peripheral"**.
- If board is `nrf52840dk` and project is `central`, label it "Central (nRF52840 DK)".

**If device listing fails:** Use `ask_followup_question`:
- Question: *"I couldn't list connected devices. Please check USB connections."*
- Options: `["Retry", "Enter serial number manually", "Cancel"]`

- Be helpful and guide the user on how to check if the device is connected like: the DK LED shouldn't be blinking, check nRF Connect extension to see if the device is connected, try to unplug and replug the device, try a different USB port, try a different USB cable...etc

---

## Step 3: Proactive Proposal

After matching devices to projects, use `ask_followup_question` — never ask an open-ended question:
- Question (example): *"I found **Heart Rate Central** (RTT, nRF52840 DK) and **Peripheral** (RTT, nRF52832 DK), and two connected devices. Capture logs from both to debug the connection?"*
- Options: `["Capture from both devices", "Only Central", "Only Peripheral", "I already have logs — analyze them"]`

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
- **Code change needed** (fix a bug found in analysis) → Invoke `workflows/debug-loop.md`
- **More logging needed** (sparse logs, need deeper BLE logs) → Invoke `workflows/log-generator.md`
- **Analysis complete, user satisfied** (e.g., they selected "Done") → Use the `attempt_completion` tool to securely terminate the workflow.
