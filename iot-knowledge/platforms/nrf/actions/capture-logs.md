# Action: Capture Device Logs (actions/capture-logs.md)

## When Used
Called from: Debug Loop Phase 3, Log Analyzer Step 4, Log Generator post-build verification.

## Pre-conditions
- Device is flashed and running firmware with logging enabled
- Log backend detected from `prj.conf` (RTT or UART)
- Device serial number (for RTT) or port (for UART) is known
- **Process Cleanup required:** Run cross-platform process cleanup before any capture.
  - Linux/Mac: `pkill -9 JLink && pkill -9 nrfutil`
  - Windows: `taskkill /F /IM JLink.exe & taskkill /F /IM nrfutil.exe`

## Transport Selection
Detect from `prj.conf`:
- `CONFIG_USE_SEGGER_RTT=y` AND `CONFIG_LOG_BACKEND_RTT=y` → **RTT**
- `CONFIG_LOG_BACKEND_UART=y` (or no explicit backend — UART is default) → **UART**
- Both can be enabled — prefer RTT for development (faster, no cable needed beyond J-Link)

## Execution
Use `nrf_device_tool` with `action="log_device"` and `operation="capture"`.

**Do NOT expose internal tool names to the user.** Say: *"Capturing RTT logs..."* not *"Running nrf_device_tool with transport=rtt"*.

### Single Device
```
nrf_device_tool: action="log_device", operation="capture", transport="rtt", port="<serial_number>", duration="<seconds>"
```

### Multi-Device Simultaneous Capture
```
nrf_device_tool: action="log_device", operation="capture", transport="rtt", devices="central:<sn1>,peripheral:<sn2>", duration="<seconds>"
```

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

### Folder Structure
```
logs/
├── rtt/
│   └── {device_role}_{device_type}_{sn}_{timestamp}.log
└── uart/
    └── {device_role}_{device_type}_{port}_{timestamp}.log
```

### Field Definitions
- **`device_role`**: Application/BLE role — `central`, `peripheral`, `ibeacon`, `iot_gateway`, `parking_sensor`, etc.
- **`device_type`**: SoC name — `nrf52840`, `nrf52832`, `nrf5340`
- **`sn`** (RTT): J-Link serial number — e.g. `683007782`
- **`port`** (UART): OS serial port — e.g. `ttyACM0`, `COM8` (omit the `/dev/` prefix)
- **`timestamp`**: `YYYYMMDD_HHMMSS` — e.g. `20260406_015243`

### Examples
```
logs/rtt/central_nrf52840_683007782_20260406_015243.log
logs/uart/peripheral_nrf52832_ttyACM1_20260406_015500.log
```

## Output
Return the **absolute path** of the saved log file(s) to the user so they can click to view.
