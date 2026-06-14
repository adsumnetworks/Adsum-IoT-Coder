---
id: adsum/esp/actions/flash
title: "Action: Flash Firmware"
type: action
version: 1.0.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: esp
---

# Action: Flash Firmware (actions/flash.md)

## When Used
Called from: Debug Loop Phase 2, or any task deploying firmware to a board. Run via `triggerEspAction` action="flash".

## Pre-conditions
- Build succeeded (binaries exist in `build/`).
- The ESP board is connected via USB.

## Port: discover once, then ALWAYS pass it
**Do NOT flash without a port.** A portless `idf.py flash` makes esptool open every serial device on the machine (`/dev/ttyS0`…`ttyS31` on Linux) one by one — 30+ failed attempts before it finds the board. It also picks the wrong board when two are connected.

1. If you don't already have the port from device discovery (`rules/device-identity.md`), get it: `triggerEspAction` action="execute" command="`python -m serial.tools.list_ports`".
   - Linux: `/dev/ttyUSB*` (UART bridge) or `/dev/ttyACM*` (native USB-Serial-JTAG).
   - macOS: `/dev/cu.usbserial-*` or `/dev/cu.usbmodem*`. Windows: `COMx`.
2. Flash with the explicit port (reuse it for the rest of the task):
   ```
   triggerEspAction  action="flash"  port="/dev/ttyACM0"
   ```
3. If `list_ports` shows two ESP ports, ask the user which board to target before flashing.

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
