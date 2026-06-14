---
id: adsum/esp/actions/analyze-logs
title: "Action: Analyze Device Logs"
type: action
version: 1.0.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: esp
requires:
  - adsum/nrf/actions/capture-logs
---

# Action: Analyze Device Logs (actions/analyze-logs.md)

## When Used
Called from: Debug Loop Phase 4, or when the user pastes a serial dump / crash. Correlate the log against the project source and `sdkconfig`.

## Resolve the log path FIRST
Captured filenames embed a timestamp. Before `read_file`, run `list_files` on `logs/uart/` and pick the **most recently created** file. Never guess the filename. If the directory is empty, capture first (`actions/capture-logs.md`) — don't loop on read retries.

## ESP-IDF Log Format
`I (12345) TAG: message` → level (`E/W/I/D/V`), milliseconds-since-boot, tag. The boot ROM/2nd-stage lines (`rst:0x... boot:0x...`, `Found ... SPI RAM device`, `Project name / IDF version`) tell you the **reset cause** and the hardware that came up.

## Failure-Mode Decode (the core skill)

### 1. Core panic — `Guru Meditation Error`
```
Guru Meditation Error: Core 0 panic'ed (LoadProhibited). Exception was unhandled.
...
Backtrace: 0x4008... 0x4008... 0x4200abcd:0x3ffb...
```
- `idf.py monitor` already decoded the backtrace to `file:line` (look for `func at path/file.c:NN`). Find the **first frame in the user's code** (skip `vPortTaskWrapper`, `_xt_lowint1`, RTOS internals).
- Exception type tells the class: `LoadProhibited`/`StoreProhibited` = null/invalid pointer deref; `LoadStoreAlignment` = misaligned access; `InstrFetchProhibited` = jumped to a bad address (corrupted function pointer / overflow).

### 2. Task Watchdog Timeout (TWDT)
```
E (...) task_wdt: Task watchdog got triggered. The following tasks/users did not reset the watchdog in time:
E (...) task_wdt:  - IDLE0 (CPU 0)
```
- A task hogged the CPU without yielding. Usually a `while(1)`/tight loop missing `vTaskDelay(pdMS_TO_TICKS(n))`, a busy-wait, a long blocking call on a high-priority task, or a mutex held with `portMAX_DELAY` (prefer a timeout). Fix: yield, lower priority, or move the work off the offending task.

### 3. Stack overflow
```
***ERROR*** A stack overflow in task <name> has been detected.
```
- Local buffers exceeded the task stack. Increase the `xTaskCreate` stack depth, or move large buffers to the heap/PSRAM. `CONFIG_FREERTOS_USE_TRACE_FACILITY` + `uxTaskGetStackHighWaterMark()` quantify headroom.

### 4. Heap corruption / exhaustion
- `CORRUPT HEAP: ... heap_caps_... assert` → write past a buffer / double-free / use-after-free. Enable heap poisoning (`CONFIG_HEAP_POISONING_COMPREHENSIVE`) to catch the culprit allocation.
- `mbedtls/wifi: mem alloc failed` or falling `esp_get_free_heap_size()` → leak. Check buffers freed in every path (`cJSON_Delete`, `free`, request handlers).

### 5. Brownout
- `Brownout detector was triggered` → power dip (weak cable/supply, or PSRAM+Wi-Fi current spike), board reboots. Suspect power before code.

### 6. Reset cause (top of boot)
`rst:0x1 (POWERON)` normal · `rst:0xc (SW_CPU_RESET)` panic/abort reboot · `rst:0x10 (RTCWDT_RTC_RESET)` watchdog · `TG0WDT/TG1WDT` task/int WDT.

## Code Correlation
For each error: find the source function/callback that emitted it, then check `sdkconfig` (task sizes `CONFIG_ESP_*_STACK_SIZE`, `CONFIG_ESP_TASK_WDT_*`, PSRAM, flash size) and the CMake `REQUIRES`. Most ESP runtime bugs are config/sizing/init-order, not raw logic.

## Output — Expert Report (REQUIRED in chat)
Output a structured summary **directly in the chat** (not in `<thinking>`), with key log snippets inline and the clickable log path.
```markdown
## Log Analysis — [Project / Context]

### 1. Boot & Init ✅/❌
- IDF version, reset cause, chip, PSRAM/flash detected, app_main reached?
### 2. Connectivity ✅/❌ (if Wi-Fi/BLE)
- Got IP / advertising / connection events
### 3. Errors Found ❌
- [symptom] — [decoded backtrace file:line / WDT task / reset cause] — [snippet]
**Root Cause:** [2–3 sentence assessment]
**Log file:** [absolute path]
```
Then offer next steps via `ask_followup_question` (e.g. `["Apply the fix and re-run", "Capture again (longer)", "Enable deeper logging", "Done"]`). Use `attempt_completion` only when fully done.

## Sparse logs
< ~10 meaningful lines, or only the boot banner → recommend the Log Generator workflow to add `ESP_LOG*` instrumentation.
