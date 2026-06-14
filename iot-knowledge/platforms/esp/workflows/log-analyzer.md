# Log Analyzer Workflow (workflows/log-analyzer.md)

**Triggered by:** Prompts like "Analyze device logs", "Check logs", "What do the logs say", "Why does
it crash/reset", "I want to debug my device" — for a board that is **already running** firmware (no
reflash). `debug-loop.md` Step 0 hands off here for the "already running" path.

This workflow discovers the connected board, captures live serial logs, and gives code-aware
root-cause analysis. It does **not** build or flash — if the analysis surfaces a fix, it hands back to
the Debug Loop.

---

## Step 1: Silent Workspace Analysis
Read `environment_details` silently. For EACH workspace root:
- Identify the project (a `CMakeLists.txt` referencing IDF + `main/`).
- Read `sdkconfig` for context: `CONFIG_IDF_TARGET`, Wi-Fi/BLE enabled, `CONFIG_LOG_DEFAULT_LEVEL_*`,
  `CONFIG_ESP_TASK_WDT_*`, PSRAM, flash size.
- Note the build (`build/project_description.json` → target, `app_elf`) — the `.elf` is what decodes a
  backtrace.

**Context budget:** only check workspace roots from `environment_details`. Do NOT scan Desktop, home,
or unrelated directories.

**Decision tree:**
- **ESP project found:** check for existing logs (`logs/uart/*.log`). If a recent one exists, ask:
  *"I found a log from [time ago]. Analyze it, or capture fresh?"* → `["Analyze existing", "Capture fresh"]`.
  If none → Step 2.
- **No ESP project found:** primary job is fresh capture. Warn once: *"⚠️ No ESP-IDF project is open. I
  can capture and analyze logs, but without source/`sdkconfig` I can't pinpoint the root cause or decode
  a backtrace. For full analysis, open your project folder."* Don't block; proceed to Step 2. Do NOT
  search for stray `.log` files outside the workspace.

---

## Step 2: Device Discovery
**MANDATORY (per `rules/device-identity.md`):** find the port once, then reuse it.
`triggerEspAction` action="execute" command="`python -m serial.tools.list_ports`" → pick the ESP port
(Linux `/dev/ttyUSB*`/`ttyACM*`, macOS `/dev/cu.usbserial-*`/`usbmodem*`, Windows `COMx`).
- Optionally confirm the chip: `esptool.py -p <port> flash_id`.
- **Two ESP ports** → ask which board to target; never guess.
- **Listing fails:** `ask_followup_question` → `["Retry", "Enter port manually", "Cancel"]`, and guide
  the user (re-plug, different cable/port, check the Espressif extension sees the device).

---

## Step 3: Proactive Proposal
After discovery, propose the capture with `ask_followup_question`:
- *"Found your project (`<chip>`) and one connected board. Capture the serial log now?"*
  → `["Capture logs", "I already have logs"]`
- Pick duration by goal: crash/boot 10 s · Wi-Fi connect 20–30 s · stability/leak 60 s+.

---

## Step 4: Log Capture
**MANDATORY SKILL LOAD:** if not already loaded this task, `read_file` →
`platforms/esp/actions/capture-logs.md` BEFORE capturing. It owns `action="monitor"`, the duration/
reset options, the naming convention, and the fact that **monitor already decodes panic backtraces**.
Pass the port from Step 2.

---

## Step 5: Analysis (Code-Aware)
**MANDATORY SKILL LOAD:** if not already loaded, `read_file` → `platforms/esp/actions/analyze-logs.md`
BEFORE reading the log. First `list_files logs/uart/` and pick the most recent file (timestamps — never
guess). Correlate every error with the actual source and `sdkconfig`.
- **If a panic/backtrace appears:** **MANDATORY SKILL LOAD** `platforms/esp/actions/decode-fault.md` and
  resolve it to `file:line` before reporting (a raw register dump is not an analysis).
- If the project uses Wi-Fi, reference `sdks/esp-idf/protocols/WIFI.md` for disconnect-reason codes.

---

## Step 6: Report — Expert Analysis (REQUIRED in chat)
Produce the inline structured summary from `analyze-logs.md` — organized by phase (Boot/Init,
Connectivity, Errors), with key log snippets embedded and the clickable log path. Output it **in the
chat**, not in `<thinking>`; not a weak conversational paragraph.

Then present next steps — use **`ask_followup_question`** (not `attempt_completion`):
- **Standard:** *"Analysis complete. What's next?"* → `["Generate a detailed report (.md)", "Enable deeper logging", "Capture again (longer)", "Done"]`.
- **Sparse logs** (only the boot banner / < ~10 meaningful lines): *"Logs are sparse — not enough to
  diagnose. Add more logging to the firmware?"* → `["Yes, switch to Log Generator", "Capture again longer", "I'll investigate"]`.

---

## Workflow Handoff
- **Build/flash needed** — a fix to apply, or the firmware was never flashed → hand to
  `workflows/debug-loop.md`.
- **More logging needed** (sparse / deeper) → `workflows/log-generator.md`.
- **Done** (user satisfied) → `attempt_completion` with a short final summary in `result`.
