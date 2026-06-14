---
id: adsum/esp/rules/esp-terminal
title: "ESP Platform Rule: The ESP-IDF Device Tool"
type: knowledge
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: esp
---

# ESP Platform Rule: The ESP-IDF Device Tool (rules/esp-terminal.md)

**ALL ESP-IDF commands MUST go through the `triggerEspAction` tool. NEVER run `idf.py` or `esptool.py` via `execute_command`.**

A plain terminal has no ESP-IDF environment (`IDF_PATH`, the Xtensa/RISC-V toolchain on `PATH`, the IDF Python venv), so `idf.py` will fail with *command not found*. The `triggerEspAction` tool provides that environment for you automatically — it prefers the Espressif ESP-IDF extension's sourced terminal, and otherwise sources `export.sh` itself. **You never source anything by hand and never hardcode an IDF path.**

## How to run ESP-IDF commands

| You want to… | Call |
|---|---|
| Build | `triggerEspAction` action="build" |
| Flash | `triggerEspAction` action="flash" (add `port` only if several boards) |
| Capture serial logs / a crash | `triggerEspAction` action="monitor" (`duration`, optional `name`, `reset`) |
| Anything else in the IDF env | `triggerEspAction` action="execute" command="…full command…" |

`action="execute"` runs the **full** command in the IDF environment. Use it for:
- `idf.py set-target esp32s3` · `idf.py --version` · `idf.py size` · `idf.py fullclean` · `idf.py reconfigure` · `idf.py menuconfig`
- `esptool.py flash_id` (identify the connected chip + flash size) · `esptool.py chip_id`
- `python -m serial.tools.list_ports` (enumerate serial ports)

## Critical rules
- **Never** `execute_command` for `idf.py` / `esptool.py` / `idf.py monitor`.
- **Never** run `idf.py monitor` through `action="execute"` — it runs forever and hangs the session. Use `action="monitor"`, which captures for a bounded `duration` and saves to a log file.
- **Do NOT expose tool names** to the user. Say *"Building firmware…"*, *"Capturing the serial log…"* — not the tool/action names.
- **Reset:** `action="monitor"` resets the board before capturing by default (captures the boot sequence). Pass `reset="false"` only for mid-runtime capture.

## Commands that DO NOT use this tool
- `git`, file manipulation, host package managers (`pip`, `apt`) → `execute_command`.
- Reading/searching project files → the built-in `read_file` / `search_files` / `list_files` tools, never `cat`/`grep` in a shell.
- **Checking whether a build / artifact exists** → `list_files` on `build/` (or `read_file` `build/project_description.json`), **never** `ls .../build/*.bin` in `execute_command`. A shell `ls` can line-wrap, run in the wrong directory, or report a false "no build", and it pointlessly uses a terminal.

## If the environment can't be found
If `triggerEspAction` reports that the ESP-IDF environment could not be located, tell the user to either install the official **Espressif ESP-IDF** VS Code extension (it sets `idf.espIdfPath`) or set the `IDF_PATH` environment variable to their ESP-IDF checkout, then retry. Do NOT fall back to `execute_command`.
