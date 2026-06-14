# Log Generator Workflow (workflows/log-generator.md)

**Purpose:** Better logs = better analysis. Instrument the firmware so the Log Analyzer can do
meaningful root-cause work. Aim for logs that answer: boot/init status, connection events, error
states, and data flow. Without good logging, analysis is guesswork.

**Triggered by:** "Generate logging code", "Add logs", "Add ESP_LOG macros", "Help me debug with logs".

Adds ESP-IDF logging (`ESP_LOG*` macros) to C source and sets log verbosity correctly.

---

## Step 1: Silent Workspace Analysis
Read `environment_details`. For EACH workspace root:
- Confirm it's an ESP-IDF project (`CMakeLists.txt` referencing IDF + `main/`).
- Read `sdkconfig` for the current level: `CONFIG_LOG_DEFAULT_LEVEL_*` (NONE/ERROR/WARN/INFO/DEBUG/VERBOSE).
- Note the target (`build/project_description.json` → `target`) for context.

Gather silently — no questions in this step.

**No project found → STOP.** Use `ask_followup_question`:
- *"I can't find an ESP-IDF project in the current workspace. Please open your project folder first."*
- Options: `["I'll open my project now", "Help me start a new ESP-IDF app"]`

---

## Step 2: Decision Point — Single vs Multi-Project
- **Single:** report *"Found project `<name>` (`<chip>`) at `<path>`."* and proceed to Step 3.
- **Multiple:** `ask_followup_question` → *"Which project(s) should I add logging to?"* →
  `["All projects", "Only <A>", "Only <B>"]`. Wait for the selection.

---

## Step 3: Code Injection
For each selected project, in the relevant `.c` files:
1. `#include "esp_log.h"` at the top.
2. A module tag once per file: `static const char *TAG = "<module>";`.
3. Inject `ESP_LOGE/W/I/D` at strategic points (not noise):
   - Before/after hardware and subsystem init (`nvs_flash_init`, `esp_wifi_init`, driver setup) — log
     the `esp_err_t` with `esp_err_to_name(err)`.
   - Wi-Fi/BLE event handlers (connect, disconnect + reason, got-IP).
   - Error branches and every `!= ESP_OK` path.
   - Task entry and each loop iteration's key state (rate-limited — avoid flooding a tight loop).

**Constraint:** apply the code directly. Don't write a markdown plan about what you'll do — just do it.

---

## Step 4: Set the log level so the messages actually print
`ESP_LOGI/D` only appear if the level allows them. Check `sdkconfig`:
- If `CONFIG_LOG_DEFAULT_LEVEL` is below your macros (e.g. set to WARN but you added `ESP_LOGI`), use
  `ask_followup_question`: *"Your default log level is `<level>`, so the new INFO/DEBUG logs won't show.
  Raise it to INFO (or DEBUG)?"* → `["Set to INFO", "Set to DEBUG", "Leave it"]`.
- Apply via `actions/configure.md` (set `CONFIG_LOG_DEFAULT_LEVEL_*` in `sdkconfig` **and**
  `sdkconfig.defaults`, then rebuild). For one noisy subsystem, prefer a **runtime per-tag** level in
  code instead of a global bump: `esp_log_level_set("wifi", ESP_LOG_WARN);`.

---

## Step 5: Deeper subsystem logs (optional)
If debugging a specific subsystem, raise just its tag rather than everything:
- **Wi-Fi:** `esp_log_level_set("wifi", ESP_LOG_DEBUG);` (+ see `sdks/esp-idf/protocols/WIFI.md` for the
  disconnect-reason codes). **BLE (NimBLE):** raise the `NimBLE`/`nimble` tag.
- Avoid global `VERBOSE` — it floods the UART and can starve timing-sensitive tasks. Enable only the
  tag matching the current scenario.

---

## Step 6: Build & Flash
Offer next steps with **`ask_followup_question`** only (not `attempt_completion`):
- *"Code is ready. How would you like to proceed with Build & Flash?"*
  → `["Build & Flash now (ask each time)", "Build & Flash autonomously", "I'll do it manually"]`
- "now / autonomously" → start `workflows/debug-loop.md` in the matching permission mode.
- "manually" → you may `attempt_completion`.

---

## Workflow Handoff — Verification Capture
After a successful Build & Flash:
- `ask_followup_question`: *"Flashed. Capture a short verification log to confirm the logging works?"*
  → `["Capture verification logs", "Skip verification"]`.
- If capturing: **MANDATORY SKILL LOAD** `read_file` → `platforms/esp/actions/capture-logs.md`, then
  capture (~15 s) and confirm your new `TAG` lines appear.
- **Verified** → offer the full analysis: `["Yes, start Log Analyzer", "No, I'm done"]`.
- **Missing** → re-check the injection (tag/level wrong, or the level gate from Step 4); fix and re-flash.
