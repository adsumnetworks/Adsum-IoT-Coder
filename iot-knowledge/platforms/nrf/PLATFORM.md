# Nordic nRF — Platform Index

This file is the entry point for all nRF platform knowledge. It lists what is available and points the agent to the right files.

## Platform Overview
Nordic Semiconductor nRF SoC family — ARM Cortex-M based microcontrollers for wireless IoT applications.

## Supported Boards
Load the specific board file when working on a project targeting that board.

| Board Target | SoC | Board File | Key Features |
|---|---|---|---|
| `nrf52840dk/nrf52840` | nRF52840 | `boards/nrf52840.md` | BLE 5.0, USB, NFC, Thread, Zigbee, 802.15.4 |
| `nrf52dk/nrf52832` | nRF52832 | `boards/nrf52832.md` | BLE 5.0, NFC (limited RAM: 64KB) |
| `nrf5340dk/nrf5340/cpuapp` | nRF5340 | `boards/nrf5340.md` | Dual-core, BLE 5.3, TrustZone |

Board targets use the Zephyr format: `<board>/<soc>` (e.g., `nrf52840dk/nrf52840`).

## Supported SDKs
| SDK | File | Build System |
|---|---|---|
| Nordic Connect SDK (NCS) + Zephyr RTOS | `sdks/ncs/SDK.md` | `west` (CMake + Ninja) |

## Platform Tools (nRF Connect Terminal)
All commands below MUST run in the nRF Connect Terminal (see `rules/nrf-terminal.md`).

### Device Commands
- `nrfutil device list` — List connected J-Link devices. Best for:
    - Port number (for UART logging)
    - Serial number (for RTT logging and flashing)
    - Available device traits (`serialPorts`, etc.)
- `nrfutil device device-info` — Get detailed device info:
    - deviceFamily, deviceName, deviceVersion
- `nrfutil toolchain-manager list` — Show installed NCS SDK versions and paths

### Auto-Install Guard
If `nrfutil device` fails: `nrfutil install device`
If `nrfutil toolchain-manager` fails: `nrfutil install toolchain-manager`

### Build & Flash Tools
- `west build` — Build firmware (see `actions/build.md` for full reference)
- `west flash` — Flash firmware (see `actions/flash.md` for full reference)
- `west build -t menuconfig` — Interactive Kconfig editor

### Log Capture
Use the dedicated `nrf_device_tool` for live log capture (RTT/UART).
See `actions/capture-logs.md` for usage and file naming conventions.

## Skill Library Index (MANDATORY READING)
The following actions and workflows are strict, custom-built skills. **DO NOT rely on your pre-trained knowledge, assumptions, or general debugging intuition to execute these.** 

**CRITICAL RULE:** If the user's request matches one of these skills, your *very first action* MUST be using the `read_file` or `view_file` tool to load the corresponding `.md` file.

### Actions (Atomic Operations)
- `platforms/nrf/actions/build.md` — Building firmware
- `platforms/nrf/actions/flash.md` — Flashing firmware to device
- `platforms/nrf/actions/capture-logs.md` — Capturing live device logs
- `platforms/nrf/actions/analyze-logs.md` — Analyzing captured log files

### Workflows (Multi-Step Chains)
- `platforms/nrf/workflows/log-generator.md` — Adding logging instrumentation to firmware
- `platforms/nrf/workflows/log-analyzer.md` — A guided sequence to capture and analyze logs
- `platforms/nrf/workflows/debug-loop.md` — Iterative Build/Flash/Capture/Analyze cycle
