---
id: adsum/esp/actions/capture-logs
title: "Action: Capture Device Logs"
type: action
version: 1.0.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: esp
---

# Action: Capture Device Logs (actions/capture-logs.md)

## When Used
Called from: Debug Loop Phase 3, or whenever you need the serial output to diagnose boot, Wi-Fi, crashes or coredumps. Run via `triggerEspAction` action="monitor".

## Why action="monitor" (never run `idf.py monitor` directly)
`idf.py monitor` takes over the terminal and runs until `Ctrl+]`, which you cannot send — it would hang the session. `action="monitor"` wraps it: it runs for a bounded **duration**, saves the output to a correctly-named log file, then stops cleanly. Because it *is* `idf.py monitor`, **panic backtraces are already decoded to `file:line`** in the captured file (the whole reason to capture on ESP).

## Execution
```
triggerEspAction  action="monitor"  duration="10"  name="boot"
```
- `duration` — seconds to capture (see table).
- `name` — optional label for the filename (e.g. `boot`, `wifi`, `crash`).
- `port` — **pass the port you discovered** (`rules/device-identity.md`). Without it the monitor tries to auto-pick; the capture script will pick the first USB serial port to avoid scanning every `/dev/ttyS*`, but the explicit port is correct and required when two boards are connected.
- `reset` — defaults to **true** (resets the board first, capturing the full boot sequence). Pass `reset="false"` for **mid-runtime** capture (e.g. you want to observe steady-state without rebooting).

The board must already be flashed with the current firmware, and a build must exist (the `.elf` is what decodes the backtrace).

## Recommended Durations
| Scenario | Duration |
|---|---|
| Crash / boot / panic | 10 s |
| Wi-Fi connect / reconnect | 20–30 s |
| Stability / leak watch | 60+ s |

## Log File Naming
The tool writes to:
```
logs/uart/<name>_<chip>_<port>_<YYYYMMDD_HHMMSS>.log
# e.g. logs/uart/crash_esp32s3_ttyUSB0_20260604_142231.log
```
- `name` — your label (defaults to the chip name).
- `chip` — read from `build/project_description.json` (what the firmware was built for).
- `port` — sanitized serial port (`/dev/` stripped) or `auto`.

## Output
The tool prints a one-line summary (line count + any detected markers: *Guru Meditation, panic backtrace, Task watchdog, brownout, …*) and the **absolute log path**. Before reading the file, the workflow uses `list_files` on `logs/uart/` to get the exact captured filename (it embeds a timestamp — never guess it), then hands the most recent file to `actions/analyze-logs.md`.
