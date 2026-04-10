# Action: Flash Firmware (actions/flash.md)

## When Used
Called from: Debug Loop Phase 2, or any task requiring firmware deployment to a device.

## Pre-conditions
- Build succeeded (`build/zephyr/zephyr.hex` exists)
- Device is physically connected via USB/J-Link
- nRF Connect Terminal available

## First-Flash Protocol
On the **first flash** in a task/session:
1. Run `nrfutil device list` to get connected devices (serial numbers, ports, types).
2. Run `nrfutil device device-info --serial-number <SN1,SN2,...>` to get `deviceFamily`, `deviceName`, `deviceVersion`. Confirm the device family matches the build target.
3. If multiple devices are connected, ask the user to identify which device to flash. Always use `--snr <serial_number>` in your flash command.

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
west flash --snr <serial_number>
# Example: west flash --snr 683007782
```
**CRITICAL:** If multiple devices are connected and `--snr` is not specified, `west flash` may flash the wrong device or fail with an ambiguity error, so the best practice is to use `--snr` always.

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
  - Windows: `taskkill /F /IM JLink.exe & taskkill /F /IM nrfutil.exe`
- `ERROR: An error occurred while flashing` → Check USB cable, try a different port, or power cycle the DK.

On flash failure, always offer: `["Retry flash", "Check device connection", "Cancel"]`

## Post-Flash
After successful flash:
- The device resets automatically and begins running the new firmware.
- Proceed to log capture if the workflow requires verification.
