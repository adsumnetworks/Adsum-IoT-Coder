# Log Analyzer Workflow

**Triggered by:** Prompts like "Analyze device logs", "Check logs", "What do the logs say", "Analyze nRF logs"

This workflow intelligently matches connected devices to open projects, captures live logs, and provides root-cause analysis.

---

## Step 1: Silent Workspace Analysis

Read `environment_details` silently. For EACH workspace root:
- Identify the project by looking for `CMakeLists.txt`, `prj.conf`, and `src/`.
- Read `prj.conf` to detect:
  - **Log backend:** `CONFIG_USE_SEGGER_RTT=y` (RTT) or `CONFIG_LOG_BACKEND_UART=y` (UART).
  - **BLE role:** `CONFIG_BT_CENTRAL=y` or `CONFIG_BT_PERIPHERAL=y`.
- Note the board from `build/**/build_info.yml`.

Do NOT list devices or ask questions yet.

---

## Step 2: Device Discovery & Intelligent Matching

List connected devices using the device tool (do NOT expose internal tool names).

**Intelligent Matching Rules:**
- If project name contains `central` OR config has `CONFIG_BT_CENTRAL=y` → refer to that device as **"Central"**.
- If project name contains `peripheral` OR config has `CONFIG_BT_PERIPHERAL=y` → refer to that device as **"Peripheral"**.
- If board is `nrf52840dk` and project is `central`, label it "Central (nRF52840 DK)".

**If device listing fails:** Use `ask_followup_question`:
- Question: *"I couldn't list connected devices. Please check USB connections."*
- Options: `["Retry", "Enter serial number manually", "Cancel"]`

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

Capture using the device tool with the detected transport (RTT/UART). Name files: `<role>_<serialnumber>_<timestamp>.log`.

---

## Step 5: Analysis (Code-Aware)

After capturing, read and analyze the log file. Go beyond surface-level observation:
- If log shows `Error -128` → find the disconnect handler in the source code.
- If log shows `Advertising timeout` → check `bt_le_adv_start` parameters.
- If log shows `kernel panic` or `Zephyr Fatal Error` → trace the call stack.
- If log shows dropped/missed events → check thread priorities and stack sizes in Kconfig.

Correlate every error with the actual source code when possible.

---

## Step 6: Report — Expert Analysis Template

After analysis, ALWAYS produce an inline structured summary. Never provide just 1-2 sentences.

```markdown
## Log Analysis — [Project Name / Context]

**System Overview:**
- **[Role] Device** ([SN]): [Function] — [State]

**Connection Flow Analysis:**

### 1. Boot & Initialization ✅/❌
- [SDK version, init events, key subsystem startup]

### 2. Discovery & Connection ✅/❌
- [Advertising/scanning params, RSSI, PHY, address]

### 3. Service Discovery & Subscription ✅/❌
- [UUIDs, handles, CCCD write status]

### 4. Data Transfer ✅/❌
- **Stats:** [count] notifications, [interval] ms, [size] bytes
- **Reliability:** No dropped packets / [X] errors

**Conclusion:**
[Professional 2-3 sentence summary of stability and root cause if any]
```

After the report, use `ask_followup_question`:

**Standard case:**
- Question: *"Analysis complete. What's next?"*
- Options: `["Generate detailed report (.md)", "Enable deeper logging", "Trigger another capture", "Done"]`

**Sparse logs / no meaningful data:**
- Question: *"Logs are sparse — not enough data to diagnose. Would you like to add more logging to the firmware?"*
- Options: `["Yes, switch to Log Generator", "Capture again with longer duration", "No, I'll investigate manually"]`
