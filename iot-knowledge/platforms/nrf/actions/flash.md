---
id: adsum/nrf/actions/flash
title: "Action: Flash Firmware"
type: action
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
safety: [flash, erase, process-kill]
---

# Action: Flash Firmware (actions/flash.md)

## When Used
Called from: Debug Loop Phase 2, or any task requiring firmware deployment to a device.

## Pre-conditions
- Build succeeded — resolve the artifact from the build tree (sysbuild puts it at
  `<build_dir>/<app-folder>/zephyr/zephyr.hex` or `<build_dir>/merged.hex`; see `build.md` Output)
- Device is physically connected via USB/J-Link
- nRF Connect Terminal available

## First-Flash Protocol
On the **first flash** in a task/session:
1. Run `nrfutil device list` to get connected devices (serial numbers, ports, types).
2. Run `nrfutil device device-info --serial-number <SN1,SN2,...>` to get `deviceFamily`, `deviceName`, `deviceVersion`. Confirm the device family matches the build target.
3. If multiple devices are connected, ask the user to identify which device to flash. Always select it explicitly: prefer `--dev-id <serial_number>` (current). `--snr` is **deprecated** — recent `west flash` prints a deprecation warning and may stop accepting it.

## Execution — NCS/Zephyr (`west flash`)

### Standard Flash (single device, single build)
```bash
west flash
```

### Flash with Specific Build Directory
```bash
west flash -d <build_directory>
# Example: west flash -d build_peripheral
```

### Multi-Device Flash (multiple J-Link devices connected)
```bash
west flash --dev-id <serial_number>
# Example: west flash --dev-id 683007782
```
**CRITICAL:** If multiple devices are connected and `--dev-id` is not specified, `west flash` may flash the wrong device or fail with an ambiguity error, so the best practice is to pass `--dev-id` always. (`--snr` is the deprecated form of this flag.)

### Alternative — direct programming via nrfutil
When you have a specific HEX/ZIP artifact, or want a runner-independent path:
```bash
nrfutil device program --serial-number <serial_number> --firmware <abs-path-to-zephyr.hex>
# Program all J-Link devices: nrfutil device program --traits jlink --firmware <hex>
```

### Flash with Erase
```bash
west flash --erase
```
Full chip erase before flashing. Useful when switching between incompatible firmware images.

## Error Handling
Common flash failures:
- `ERROR: JLinkARM.dll: No matching device found` → Device not connected or wrong serial number
- `ERROR: The flashing operation timed out` → J-Link busy (another process holds it). Process cleanup required:
  - Linux/Mac: `pkill -9 JLink && pkill -9 nrfutil`
  - Windows: `cmd /c "taskkill /F /IM JLink.exe 2>nul & taskkill /F /IM nrfutil.exe 2>nul"` (wrap in `cmd /c` so it works in PowerShell — `&` is reserved in PowerShell, but cmd.exe parses the quoted string natively)
- `ERROR: An error occurred while flashing` → Check USB cable, try a different port, or power cycle the DK.

On flash failure, always offer: `["Retry flash", "Check device connection", "Cancel"]`

## Post-Flash
After successful flash:
- The device resets automatically and begins running the new firmware.
- Proceed to log capture if the workflow requires verification.
