---
id: adsum/esp/boards/esp32-s3
title: "ESP32-S3 — Board Knowledge"
type: knowledge
version: 1.0.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: esp
---

# ESP32-S3 — Board Knowledge

## Hardware Overview
- **SoC:** ESP32-S3 — dual-core **Xtensa LX7** @ up to 240 MHz, with vector instructions (AI/DSP).
- **Internal SRAM:** 512 KB · **ROM:** 384 KB · **RTC SRAM:** 16 KB.
- **External flash:** SPI NOR, module-dependent (commonly 8 MB or 16 MB). Confirm with `esptool.py flash_id`.
- **External PSRAM (optional):** up to 8 MB — **Quad** (e.g. N8R2 = 8 MB flash + 2 MB PSRAM) or **Octal** (e.g. N16R8 = 16 MB flash + 8 MB PSRAM).
- **Radio:** Wi-Fi 4 (2.4 GHz 802.11 b/g/n) **+ Bluetooth LE 5** (no Classic BT).
- **USB:** native **USB-OTG** and a built-in **USB-Serial-JTAG** controller (flash/monitor/debug over one USB cable, no external probe).

## Board Target
Use **`esp32s3`** as the target: `idf.py set-target esp32s3`.

## Dev Kit: ESP32-S3-DevKitC-1
- **Two USB ports:** the **UART** port (CP2102/CH340 bridge → `/dev/ttyUSB*` on Linux, `COMx` on Windows) and the native **USB** port (USB-Serial-JTAG → `/dev/ttyACM*` on Linux). Either can flash/monitor; if both are plugged in you'll see two ports — disambiguate with `port`.
- **Buttons:** `BOOT` (GPIO0) and `EN` (reset). Hold `BOOT` while connecting only if auto-reset into download mode fails.
- **RGB LED** on GPIO48 (or 38 on some revisions) via the `led_strip` component.

## PSRAM — critical knowledge
- PSRAM is **off unless enabled**: `CONFIG_SPIRAM=y`. Octal modules also need `CONFIG_SPIRAM_MODE_OCT=y` (Quad is the default mode).
- Wrong mode → boot log: `PSRAM ID read error … PSRAM chip not found or not supported, or wrong PSRAM line mode`.
- Confirm at runtime in the boot log: `Found 8MB SPI RAM device` + `SPI RAM mode: ... QIO/OPI`.
- Large buffers (Wi-Fi/TLS/camera/LVGL) should live in PSRAM (`heap_caps_malloc(size, MALLOC_CAP_SPIRAM)`) to spare internal SRAM.

## Debugging notes
- **Built-in USB-JTAG:** breakpoints/watchpoints via OpenOCD + GDB with no external probe — a later HITL upgrade beyond serial + coredump.
- **Brownout** (`Brownout detector was triggered` → reboot loop) is common with a weak USB cable or when PSRAM + Wi-Fi TX spike current. Suspect power/cable first.
- **Monitor reset:** `action="monitor"` resets the board before capture (DTR/RTS on the UART bridge, or the USB-Serial-JTAG). Known quirk: on the native USB-Serial-JTAG port, a reset can drop the USB connection briefly.
- **Flash size mismatch:** if `CONFIG_ESPTOOLPY_FLASHSIZE` exceeds the real flash (from `flash_id`), the app boot-loops or won't flash. Match it to the chip.
