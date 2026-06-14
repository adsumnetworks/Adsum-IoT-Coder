---
id: adsum/esp/platform
title: "ESP32 — Platform Index"
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

# ESP32 — Platform Index (`platforms/esp/`)

Master index for Espressif ESP32 / ESP-IDF development (baseline **ESP-IDF v5.x**, written version-agnostically). It tells you what is available and when to load each resource. **Debugging on real hardware is the core job; app generation is a starting point that feeds into it.**

---

## Directory Map

```text
platforms/esp/
├── PLATFORM.md              ← You are here. Master index.
├── rules/
│   ├── esp-terminal.md      ← CRITICAL: use triggerEspAction, never execute_command (always)
│   ├── skill-loading.md     ← Workflows vs Actions hierarchy + Command Gate (always)
│   └── device-identity.md   ← Identify chip/flash/PSRAM before building (always)
├── boards/                  ← Per-chip hardware constraints (load per target)
│   ├── esp32-s3.md
│   └── esp32-devkitc-v4.md
├── sdks/esp-idf/
│   ├── SDK.md               ← idf.py, CMake, FreeRTOS, sdkconfig, introspection
│   └── protocols/
│       ├── WIFI.md          ← Wi-Fi STA/AP, HTTP server, failure modes
│       └── BLE.md           ← NimBLE basics (load on BLE projects)
├── actions/                 ← Internal subroutines (load ONLY when a Workflow instructs, or the Command Gate fires)
│   ├── build.md, flash.md, capture-logs.md, analyze-logs.md, configure.md,
│   └── find-sample.md, run-tests.md, decode-fault.md, setup-ci.md
└── workflows/               ← Primary entry points (START HERE for each task)
    ├── debug-loop.md        ← Build → Flash → Capture → Analyze → Fix (primary)
    ├── log-analyzer.md      ← Capture + root-cause for a board already running (no reflash)
    ├── log-generator.md     ← Add ESP_LOG* instrumentation to existing source
    ├── prototype.md         ← SCAFFOLD: new app composed from verified IDF examples
    ├── add-feature.md       ← SCAFFOLD: add one feature/component to an existing app
    └── test-validate.md     ← Unity via host (linux) / QEMU / on-hardware + behavioral validation
```

---

## Rules (`rules/`) — load all three, always

| File | Purpose |
|---|---|
| `rules/esp-terminal.md` | ALL idf.py/esptool commands go through `triggerEspAction`, never `execute_command`. |
| `rules/skill-loading.md` | Workflows are entry points; Actions load only when a Workflow says so. |
| `rules/device-identity.md` | Identify the connected chip, flash size and PSRAM before building. Never guess the target. |

---

## Hardware (`boards/`)

Load the board file once the target chip is known (from `sdkconfig`, the build artifact, or `esptool.py flash_id`).

| Chip target | File |
|---|---|
| `esp32s3` | `boards/esp32-s3.md` |
| `esp32` (DevKitC v4) | `boards/esp32-devkitc-v4.md` |

Other targets (`esp32c6`, `esp32c3`, …) are supported by the toolchain; board files are added as they are validated on hardware.

---

## SDKs (`sdks/`)

| SDK | File | When to Load |
|---|---|---|
| ESP-IDF | `sdks/esp-idf/SDK.md` | First ESP-IDF task. idf.py/CMake/FreeRTOS/sdkconfig + device introspection. |
| Wi-Fi | `sdks/esp-idf/protocols/WIFI.md` | Project uses Wi-Fi. |
| BLE (NimBLE) | `sdks/esp-idf/protocols/BLE.md` | Project uses BLE (`CONFIG_BT_ENABLED=y`). |

---

## Platform Tool — `triggerEspAction`

Your single interface to the ESP-IDF toolchain. It provides the sourced environment for you (prefers the Espressif extension's terminal, else self-sources). **Do NOT expose the tool name** — say *"Building firmware…"*.

| Action | Use |
|---|---|
| `action="build"` | `idf.py build`. Full reference in `actions/build.md`. |
| `action="flash"` | `idf.py flash` (+`port` if several boards). `actions/flash.md`. |
| `action="monitor"` | Capture serial logs/crashes for `duration` s to `logs/uart/…` (panic backtraces decoded). `actions/capture-logs.md`. |
| `action="execute"` | Any other command: `idf.py set-target/size/--version/fullclean/reconfigure`, `esptool.py flash_id`, `python -m serial.tools.list_ports`. |

**Device discovery (before first build/flash):** `esptool.py flash_id` (chip+flash), `idf.py --version`, `python -m serial.tools.list_ports`. See `rules/device-identity.md`.

---

## Skill Library Index

See `rules/skill-loading.md` for the mandatory loading protocol.

### Primary Entry-Point Workflows (START HERE)

| Workflow | File | Purpose |
|---|---|---|
| **Debug Loop** | `workflows/debug-loop.md` | Iterative Build → Flash → Capture → Analyze → Fix. The headline. |
| Log Analyzer | `workflows/log-analyzer.md` | Capture + code-aware root-cause for a board already running (no reflash). |
| Log Generator | `workflows/log-generator.md` | Inject `ESP_LOG*` instrumentation into existing source. |
| Prototype | `workflows/prototype.md` | Compose a new ESP-IDF app from verified IDF examples / registry components. |
| Add Feature | `workflows/add-feature.md` | Port one feature/component into an existing app, then verify via Debug Loop. |
| Test & Validate | `workflows/test-validate.md` | Unity via host (`linux`) / QEMU / on-hardware + behavioral validation + CI offer. |

### Internal Actions (loaded when a Workflow instructs, or the Command Gate in `rules/skill-loading.md` fires)

| Action | File | Purpose |
|---|---|---|
| Build | `actions/build.md` | `idf.py build`; target resolution & error handling. |
| Flash | `actions/flash.md` | `idf.py flash`; discover port once, always pass it. |
| Capture Logs | `actions/capture-logs.md` | Serial capture via `action="monitor"`; naming convention. |
| Analyze Logs | `actions/analyze-logs.md` | Decode panics/WDT/brownout/heap; structured report. |
| Configure | `actions/configure.md` | Change a Kconfig value the right way — `sdkconfig` vs `sdkconfig.defaults`. |
| Find Sample | `actions/find-sample.md` | Map a capability to the verified IDF example / registry component to copy or pull. |
| Run Tests | `actions/run-tests.md` | Build + run Unity suites (host `linux` / QEMU / on-hardware via pytest-embedded). |
| Decode Fault | `actions/decode-fault.md` | Symbolize a panic backtrace to `file:line` (addr2line / coredump). |
| Set Up CI | `actions/setup-ci.md` | GitHub Actions: build + host/QEMU tests on every PR. |

---

## Resources
- **ESP-IDF Programming Guide:** https://docs.espressif.com/projects/esp-idf/
- **esptool:** https://docs.espressif.com/projects/esptool/
- **ESP Component Registry:** https://components.espressif.com/
