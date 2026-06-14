---
id: adsum/nrf/actions/build
title: "Action: Build Firmware"
type: action
version: 1.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: nrf
---

# Action: Build Firmware (actions/build.md)

## When Used
Called from: Debug Loop Phase 1, Log Generator Step 6, or any task requiring firmware build and flash.

## Pre-conditions
- Project detected (CMakeLists.txt + prj.conf)
- nRF Connect Terminal available

## Board Target Resolution (BEFORE ANY BUILD)

You have two data sources for board targets. You MUST cross-reference them before building.

### Source 1: Existing Build Folders (from System Prompt)
The system prompt injects: `Existing Build Folders: <dir>/ → board: <board_target> (from build_info.yml)`.
This tells you what the project was **previously** built for. It is historical data, not a live state.

### Source 2: Connected Devices (from Runtime Discovery)
Run device discovery (if not already done in this task):
1. `nrfutil device list` → serial numbers of all connected devices
2. `nrfutil device device-info --serial-number <SN1,SN2,...>` → `deviceFamily`, `deviceName`, `deviceVersion`

### Decision Matrix

| Scenario | Action |
|---|---|
| 1 build folder + 1 matching device | Confirm: *"Build `<dir>` targets `<board>` and your connected device matches. Build for `<board>`?"* |
| 1 build folder + device **MISMATCH** | **STOP.** Ask: *"Existing build targets `<board_A>` but connected device is `<board_B>`. Which target?"* Options: `["Build for connected device (<board_B>)", "Keep existing target (<board_A>)", "Let me explain"]` |
| Multiple build folders + 1 device | Ask which build dir to use |
| Multiple build folders + multiple devices | Ask user to clarify the target build + device pair |
| No build folder + device connected | First build: confirm target derived from device info |
| Build folder + no device connected | Warn: *"No device detected. I'll build for `<board>` from existing config. Flash will require a connected device."* |

**CRITICAL:** Board target confirmation is NEVER skippable, even in Auto-Approve mode. Never silently resolve a mismatch — always confirm with the user.

## Execution — NCS/Zephyr (`west build`)

### Standard Build
```bash
west build -b <board>/<soc>
# Example: west build -b nrf52840dk/nrf52840
```

### Incremental Build (no config changes)
```bash
west build
```
If a previous build exists with the same board, `west build` rebuilds incrementally.

### Pristine Build (REQUIRED after config changes)
If `prj.conf`, any `.conf` overlay, or any DeviceTree file (`.overlay`, `.dts`) has been modified, use the `-p` (pristine) flag::
```bash
west build -p -b <board>/<soc>
# Example: west build -p -b nrf52840dk/nrf52840
```
**Note:** `west build -p` is equivalent to `west build --pristine=always`. It ensures a clean build system generation from scratch.
**CRITICAL:** Failing to do a pristine build after Kconfig/DT changes causes stale config bugs that are extremely hard to diagnose.

### Multi-Build Directory
If the project has multiple build folders (e.g., one per board):
```bash
west build -b <board>/<soc> -d <build_directory>
# Example: west build -b nrf52dk/nrf52832 -d build_peripheral
```

### Sysbuild (nRF5340 Dual-Core)
For nRF5340 projects that need both application and network core:
```bash
west build --sysbuild -b nrf5340dk/nrf5340/cpuapp
```
This builds both cores and their dependencies.

### Menuconfig (Interactive Kconfig)
```bash
west build -t menuconfig
```

## Error Handling
- Extract the **key error line** from the build output — do not dump raw terminal output.
- Common patterns:
  - `error: Aborting due to Kconfig warnings` → incorrect Kconfig symbol
  - `fatal error: <header>.h: No such file or directory` → missing module or wrong include path
  - `region 'FLASH' overflowed` → binary too large, disable unused features
  - `region 'RAM' overflowed` → reduce stack sizes or disable features
- On build failure, always offer: `["Attempt auto-fix", "Show full error", "Cancel"]`

## Output — artifact paths (sysbuild-aware)
Sysbuild is the **default since NCS 2.7**, so the build tree is multi-image. **Resolve the artifact by
listing the build tree** (`list_files`) — never assume it from `project()` or memory:
- **Sysbuild:** app artifacts at `<build_dir>/<app-folder-name>/zephyr/zephyr.{hex,elf,bin}`. The
  child folder is the application **directory** name, not the CMake `project()` name.
- **Multi-image** (MCUboot + app, or app + net-core): a combined `<build_dir>/merged.hex` exists —
  flash that one.
- **Non-sysbuild (legacy):** `<build_dir>/zephyr/zephyr.{hex,elf}`.

Default `<build_dir>` is `build/` unless `-d` was passed.
