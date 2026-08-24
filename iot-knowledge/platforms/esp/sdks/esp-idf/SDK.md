---
id: adsum/esp/sdks/esp-idf/sdk
title: "ESP-IDF — SDK Knowledge"
type: knowledge
version: 1.1.0
owner: adsum-core
author: Omar Morceli
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: esp
requires:
  - adsum/esp/tools/esp-action
---

# ESP-IDF — SDK Knowledge (sdks/esp-idf/SDK.md)

## Overview
ESP-IDF is Espressif's official SDK for the ESP32 family, built on **FreeRTOS**. Build/flash/monitor are driven by **`idf.py`** (a CMake + esptool front end). **Baseline: ESP-IDF v5.x.** Run everything through `triggerEspAction` (see `rules/esp-terminal.md`) — never source paths by hand.

## Project Structure
```
<project-root>/
├── CMakeLists.txt          # top-level: include($ENV{IDF_PATH}/tools/cmake/project.cmake); project(<name>)
├── main/
│   ├── CMakeLists.txt      # idf_component_register(SRCS "main.c" REQUIRES ... PRIV_REQUIRES ...)
│   ├── main.c              # entry point: void app_main(void)
│   └── idf_component.yml   # (optional) managed component dependencies
├── components/<name>/      # (optional) custom components / drivers
├── sdkconfig               # generated Kconfig config (target, PSRAM, flash size, …) — do not hand-edit blindly
├── sdkconfig.defaults      # checked-in config overrides applied on first configure
├── partitions.csv          # (optional) custom partition table
└── build/                  # generated; build/project_description.json records the target & paths
```

## idf.py — the core commands (all via `triggerEspAction`)
| Command | Action | Purpose |
|---|---|---|
| `idf.py set-target esp32s3` | execute | Select the chip (implies fullclean). Do once, confirm first. |
| `idf.py build` | build | Configure + compile. |
| `idf.py -p <port> flash` | flash | Write bootloader + partition table + app. |
| `idf.py monitor` | monitor | Serial console + automatic panic backtrace decode. (Use action="monitor".) |
| `idf.py menuconfig` | execute | Interactive Kconfig (headless: edit `sdkconfig.defaults` + `reconfigure`). |
| `idf.py reconfigure` | execute | Re-run CMake after config/CMakeLists changes. |
| `idf.py fullclean` | execute | Wipe `build/` when the build is in a bad state. |
| `idf.py size` / `size-components` | execute | Static Flash / IRAM / DRAM usage. |

## Device introspection (know your hardware — see `rules/device-identity.md`)
- `esptool.py flash_id` → chip type, revision, features (WiFi/BLE), **flash (ROM) size**.
- `idf.py --version` → ESP-IDF version.
- `python -m serial.tools.list_ports` → connected serial ports.
- PSRAM: `sdkconfig` `CONFIG_SPIRAM*`, confirmed by boot log `Found NMB SPI RAM device`.

## "idf.py is not recognized" — read this before blaming the terminal
This looks like a sourcing failure and almost never is. The device tool DOES run `export.ps1`; that
script then fails its own Python dependency check, exports nothing, and `idf.py` never reaches the PATH.

The signature, seen on a real bench 2026-08-24:
```
The expression after '.' in a pipeline element produced an object that was not valid.
At C:\esp\v5.5.4\esp-idf\export.ps1:27 char:3
+ . $idf_exports                      ← $idf_exports is EMPTY, because the check above failed
idf.py : The term 'idf.py' is not recognized …
```

**Scroll up to the real error.** It reads `* Checking python dependencies ... FAILED` and names packages:

```
Requirement 'pyparsing<3.3,>=3.1.0'   was not met. Installed version: 3.3.1
Requirement 'click<8.2,>=7.0'         was not met. Installed version: 8.2.1
Requirement 'cryptography<45,>=2.1.4' was not met. Installed version: 46.0.5
```

**Packages too NEW, not missing.** ESP-IDF pins upper bounds; a `pip install --upgrade` in the shared
venv (`~/.espressif/python_env/idf<ver>_py<pyver>_env`) breaks the ceiling and takes IDF down with it.

**The fix is IDF's own installer**, which rebuilds the venv against the constraint file:
`install.bat` (Windows) / `install.sh` (Linux, macOS) from the IDF root.

Rules:
- **Never report this as "the environment was not sourced".** It was. Say what actually failed.
- It mutates `~/.espressif` and downloads packages, so **ask before running it** — offer it as a button.
- **Check the version is actually installed before offering it.** A missing `idf<ver>` folder under
  `~/.espressif/python_env` means that IDF version was never set up, so switching to it fixes nothing.

## sdkconfig — the usual suspects
```ini
CONFIG_IDF_TARGET="esp32s3"          # build target
CONFIG_ESPTOOLPY_FLASHSIZE="8MB"     # must not exceed the real flash (from flash_id)
CONFIG_SPIRAM=y                      # external PSRAM enabled
CONFIG_FREERTOS_HZ=1000              # tick rate
CONFIG_ESP_MAIN_TASK_STACK_SIZE=3584 # app_main stack
CONFIG_ESP_TASK_WDT_TIMEOUT_S=5      # task watchdog timeout
CONFIG_LOG_DEFAULT_LEVEL_INFO=y      # global log verbosity
```
**Rule:** after editing `sdkconfig.defaults`, run `idf.py reconfigure` (or a fresh `build`) so changes take effect. A stale `sdkconfig` is a classic source of "my change did nothing" bugs.

## Logging subsystem
- `#include "esp_log.h"`; `static const char *TAG = "app";`
- `ESP_LOGE/W/I/D/V(TAG, "fmt", …)` — Error/Warn/Info/Debug/Verbose.
- Per-tag runtime level: `esp_log_level_set("wifi", ESP_LOG_WARN);`
- Default level via `CONFIG_LOG_DEFAULT_LEVEL_*`. Output format: `I (12345) TAG: message` (level, ms-since-boot, tag).

## Documentation Reference (Single Source of Truth)
These are large — consult only when the knowledge files lack the detail; do NOT read preemptively.
- ESP-IDF Programming Guide: https://docs.espressif.com/projects/esp-idf/en/stable/
- API reference (Wi-Fi, BLE, FreeRTOS, storage): under `/api-reference/`
- esptool: https://docs.espressif.com/projects/esptool/
