# Action: Flash Firmware (actions/flash.md)

## When Used
Called from: Debug Loop Phase 2, or any task deploying firmware to a board. Run via `triggerEspAction` action="flash".

## Pre-conditions
- Build succeeded (binaries exist in `build/`).
- The ESP board is connected via USB.

## Port Discovery (First-Flash Protocol)
ESP-IDF usually auto-detects the port — try a plain flash first:
```
triggerEspAction  action="flash"
```
If auto-detect fails or **multiple boards** are connected:
1. Enumerate ports: `triggerEspAction` action="execute" command="`python -m serial.tools.list_ports`".
   - Linux: `/dev/ttyUSB*` (UART bridge) or `/dev/ttyACM*` (native USB-Serial-JTAG).
   - macOS: `/dev/cu.usbserial-*` or `/dev/cu.usbmodem*`. Windows: `COMx`.
2. Confirm with the user which port is the target, then:
   ```
   triggerEspAction  action="flash"  port="/dev/ttyUSB0"
   ```

## What flash does
Writes the **bootloader + partition table + app** together (never flash just the app with raw esptool — you'll get a mismatched layout). The board resets and runs the new firmware automatically.

## Error Handling
- `Permission denied: '/dev/ttyUSB0'` (Linux) → the user must join the `dialout` group (`sudo usermod -aG dialout $USER`, then re-login) or `sudo chmod a+rw /dev/ttyUSB0`. Advise; do not sudo silently.
- `Failed to connect to ESP32: ... Wrong boot mode detected` / stuck at `Connecting....___` → advise holding the **BOOT** button while flashing begins (then release), or check the USB cable/port.
- `A fatal error occurred: ... timed out waiting for packet` → another process holds the port (a running monitor). Stop it and retry.
- `Flash size ... does not fit` → flash image larger than the chip's flash; fix `CONFIG_ESPTOOLPY_FLASHSIZE` / partition table.

On failure, offer via `ask_followup_question`: `["Retry flash", "Pick a different port", "Cancel"]`.

## Post-Flash
The board resets into the new firmware. Proceed to log capture (`actions/capture-logs.md`) when the workflow needs verification or you're debugging a runtime issue.
