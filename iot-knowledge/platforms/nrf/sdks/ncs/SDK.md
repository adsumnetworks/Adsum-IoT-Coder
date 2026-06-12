---
id: adsum/nrf/sdks/ncs/sdk
title: "Nordic Connect SDK"
type: knowledge
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
---

# Nordic Connect SDK (NCS) — SDK Knowledge (sdks/ncs/SDK.md)

## SDK Overview
NCS is Nordic's official SDK built on top of Zephyr RTOS. It provides the BLE stack (SoftDevice Controller), Thread, Zigbee, Matter, and nRF-specific libraries.
**Primary Target Version:** NCS v3.2.1 (supports Bluetooth Core Spec v6.2 and newer Zephyr 3.2+ features).

## SDK Installation Path
The NCS SDK is typically installed at:
- **Linux:** `~/ncs/<version>/` (e.g. `/home/<user>/ncs/v3.2.1/`)
- **Windows:** `C:\ncs\<version>\`
- **macOS:** `~/ncs/<version>/`

Use `nrfutil toolchain-manager list` to discover installed SDK versions and paths.

Inside the SDK: `nrf/`, `zephyr/`, `modules/`, `bootloader/`, `tools/`, `nrfxlib/`
The `west.yml` manifest lives inside the SDK (`nrf/west.yml`), NOT in user application projects.

## NCS Project Structure
A standard nRF Connect SDK application:
```
<project-root>/
├── CMakeLists.txt        # Must contain: find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
├── prj.conf              # Kconfig configuration (always present)
├── src/
│   └── main.c            # Application entry point
├── boards/               # (optional) Board-specific overlays: <board>.overlay, <board>.conf
├── sample.yaml           # (optional) Sample metadata & test definitions
├── .overlay / .dts       # (optional) DeviceTree overlays at root level
├── build/                # Generated build artifacts (never edit manually)
│   ├── zephyr/zephyr.hex # Compiled firmware image
│   ├── build_info.yml    # Build information (board, config)
│   └── merged.hex        # Combined image (app + bootloader if applicable)
└── .vscode/settings.json # nRF Connect extension workspace settings
```

## Key Configuration Files

### prj.conf (Kconfig)
Controls what subsystems and features are enabled:
```ini
CONFIG_BT=y                      # Enable Bluetooth
CONFIG_LOG=y                     # Enable logging subsystem
CONFIG_USE_SEGGER_RTT=y          # Enable RTT transport
CONFIG_LOG_BACKEND_RTT=y         # Route logs to RTT
CONFIG_LOG_BACKEND_UART=y        # Route logs to UART (enabled by default)
CONFIG_BT_PERIPHERAL=y           # BLE peripheral role
CONFIG_BT_CENTRAL=y              # BLE central role
CONFIG_BT_DEVICE_NAME="MyDevice" # BLE device name
```

### CMakeLists.txt
Must always reference Zephyr:
```cmake
cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(<app-name>)
target_sources(app PRIVATE src/main.c)
```

### DeviceTree Overlays (.overlay)
Board-specific hardware customization placed in the `boards/` directory.
Named `<board_target>.overlay` (e.g. `nrf52840dk_nrf52840.overlay`).

## Board Target Format
Board targets use the format `<board>/<soc>` (e.g. `nrf52840dk/nrf52840`).
**CRITICAL:** Always use the full target name. `nrf52840dk` alone is incomplete.

## Logging Subsystem
### Auto-detect Log Transport from prj.conf:
- `CONFIG_USE_SEGGER_RTT=y` → **RTT** (via J-Link / nRF Connect debugger)
- `CONFIG_LOG_BACKEND_UART=y` → **UART** (serial port, enabled by default)
- Both can be enabled simultaneously.
- Zephyr logging uses `LOG_MODULE_REGISTER(<name>, <level>)` in C source files.
- Per-module log levels: `LOG_LEVEL_NONE=0`, `LOG_LEVEL_ERR=1`, `LOG_LEVEL_WRN=2`, `LOG_LEVEL_INF=3`, `LOG_LEVEL_DBG=4`.

## Supported Protocols
For protocol-specific knowledge, refer to:
- **BLE:** `sdks/ncs/protocols/BLE.md`


## Memory Report

- Use this to check memory usage of the firmware.
- When using Sysbuild, you need to specify the build directory of the specific image:

```shell
west build -d build/<image_name> -t ram_report # When using Sysbuild
west build -d build/my_app -t ram_report # For example, for the main application:
west build -d build/mcuboot -t ram_report # For MCUboot:
# Example : west build -d build_32/eddystone -t ram_report
```

## Documentation Reference (SINGLE SOURCE OF TRUTH)

### NCS Documentation
Path: `/home/{user}/ncs/{version}/nrf/doc` (use `nrfutil toolchain-manager list` to find the version).
Key subdirectories:
- `app_dev/` — Application development guides
- `app_dev/config_and_build/` — Build system, Kconfig, CMake docs
- `app_dev/device_guides/nrf52/` — nRF52 specific guides
- `samples/` — Sample application docs
- `protocols/` — BLE, Thread, Zigbee, Matter protocol guides
- `libraries/` — NCS library references

### Zephyr Documentation
Path: `/home/{user}/ncs/{version}/zephyr/doc`
Key files:
- `develop/west/build-flash-debug.rst` — west build/flash/debug command reference
- `develop/application/` — Application development model

**IMPORTANT**: These docs are very large. Use them ONLY when the iot-knowledge files don't have the detail you need. Do NOT read large doc files preemptively — this causes context overflow, bad performance, and high cost.
