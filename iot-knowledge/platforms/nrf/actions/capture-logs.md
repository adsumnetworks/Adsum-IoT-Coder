---
id: adsum/nrf/actions/capture-logs
title: "Action: Capture Device Logs"
type: action
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
safety: [process-kill]
---

# Action: Capture Device Logs (actions/capture-logs.md)

## When Used
Called from: Debug Loop Phase 3, Log Analyzer Step 4, Log Generator post-build verification.

## Pre-conditions
- Device is flashed and running firmware with logging enabled
- Log backend detected from `prj.conf` (RTT or UART)
- Device serial number (for RTT) or port (for UART) is known
- **Process Cleanup required:** Run cross-platform process cleanup before any capture.
  - Linux/Mac: `pkill -9 JLink && pkill -9 nrfutil`
  - Windows: `cmd /c "taskkill /F /IM JLink.exe 2>nul & taskkill /F /IM nrfutil.exe 2>nul"` (wrap in `cmd /c` so it works in PowerShell — `&` is reserved in PowerShell, but cmd.exe parses the quoted string natively)

## Transport Selection
Detect from `prj.conf`:
- `CONFIG_USE_SEGGER_RTT=y` AND `CONFIG_LOG_BACKEND_RTT=y` → **RTT**
- `CONFIG_LOG_BACKEND_UART=y` (or no explicit backend — UART is default) → **UART**
- Both can be enabled — prefer RTT for development (faster, no cable needed beyond J-Link)

### UART Port (VCOM) Selection — which port carries logs
Nordic DKs expose **multiple VCOM ports** via the on-board J-Link. The `zephyr,console` chosen node
decides which UART carries app logs (default `&uart0`), and the OS-port mapping is **not** uniform:
| DK | App logs on |
|---|---|
| nRF52840 DK | Serial Port 0 (`uart0`) |
| nRF5340 DK | Serial Port 0 (`uart0`, app core); Port 1 = net core (`uart1`, PCB "VCOM2" label may be wrong) |
| nRF54L15 DK | **Serial Port 1** (`uart1`) — Port 0 is secondary |

If no logs appear on the first port, try the next and reset to recapture boot logs. An overlay can
reassign `zephyr,console`, shifting which VCOM carries logs — don't assume the default.

### DTR requirement (UART "opens but no data")
Nordic DK UART lines are **tri-stated until the terminal asserts DTR**. If the port opens but stays
silent even after a board reset, the capture path is not asserting DTR — the first thing to check
when a user reports a silent UART.

## Execution
Use `nrf_device_tool` with `action="log_device"` and `operation="capture"`.

**Do NOT expose internal tool names to the user.** Say: *"Capturing RTT logs..."* not *"Running nrf_device_tool with transport=rtt"*.

### Single Device
```
nrf_device_tool: action="log_device", operation="capture", transport="rtt", port="<serial_number>", duration="<seconds>"
```

### Multi-Device Simultaneous Capture
```
nrf_device_tool: action="log_device", operation="capture", transport="rtt", devices="device1:<sn1>,device2:<sn2>", duration="<seconds>"
```
**CRITICAL NOTE FOR MULTI-DEVICE:** When multiple devices are connected, you do NOT know which serial number runs which firmware. Do NOT arbitrarily assign `central` or `peripheral` to serial numbers based on project config. You **MUST** use `device1:<sn1>,device2:<sn2>` for the first capture. See `rules/device-identity.md`.

### Boot Log Capture (with pre-capture delay)
To capture the full boot sequence, use `pre-capture-delay` so listeners start before device reset:
```
nrf_device_tool: action="log_device", operation="capture", transport="rtt", port="<sn>", duration="15", pre-capture-delay="3", reset="true"
```

## Recommended Capture Parameters
- Before all captures you should reset device with reset="true" (only if the application requires runtime capture).
- For UART transport, always use pre-capture-delay="3" to wait 3 seconds before start capturing (only if the application requires runtime capture).


## Recommended Capture Durations
| Scenario | Duration |
|---|---|
| Crash / hardfault | 5 seconds |
| Boot sequence | 15 seconds (with pre-capture delay) |
| Connection debug | 15–30 seconds |
| Stability test | 60+ seconds |

## Log File Naming Convention

### Two-Phase Naming System

**Phase 1 — First Capture (role unknown):**
When device roles have NOT been confirmed yet, use generic labels:
```
logs/rtt/device1_nrf52840_683007782_20260406_015243.log
logs/rtt/device2_nrf52832_683007783_20260406_015243.log
```

**Phase 2 — Subsequent Captures (role confirmed):**
After roles are confirmed by `prj.conf` analysis or log evidence, use role-specific labels:
```
logs/rtt/central_nrf52840_683007782_20260406_020000.log
logs/rtt/peripheral_nrf52832_683007783_20260406_020000.log
```

**Exception:** If the role is already confirmed from `prj.conf` (e.g., `CONFIG_BT_CENTRAL=y` in the project flashed to a specific device), you may use the role name from the first capture.

### Folder Structure
```
logs/
├── rtt/
│   └── {device_label}_{device_type}_{sn}_{timestamp}.log
└── uart/
    └── {device_label}_{device_type}_{port}_{timestamp}.log
```

### Field Definitions
- **`device_label`**: Generic (`device1`, `device2`) or role-specific (`central`, `peripheral`, `ibeacon`, `iot_gateway`) — see Two-Phase Naming above.
- **`device_type`**: SoC name — `nrf52840`, `nrf52832`, `nrf5340`
- **`sn`** (RTT): J-Link serial number — e.g. `683007782`
- **`port`** (UART): OS serial port — e.g. `ttyACM0`, `COM8` (omit the `/dev/` prefix)
- **`timestamp`**: `YYYYMMDD_HHMMSS` — e.g. `20260406_015243`

## Output
Return the **absolute path** of the saved log file(s) to the user so they can click to view.
