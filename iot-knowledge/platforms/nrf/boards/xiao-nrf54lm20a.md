---
id: adsum/nrf/boards/xiao-nrf54lm20a
title: "Seeed XIAO nRF54LM20A — Board Knowledge"
type: knowledge
version: 1.0.0
owner: adsum-core
author: Omar Morceli
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
safety: [flash]
---

# Seeed XIAO nRF54LM20A — Board Knowledge (boards/xiao-nrf54lm20a.md)

## Hardware Overview
- **SoC:** nRF54LM20A — Arm Cortex-M33 @ 128 MHz
- **Variants:** plain and **Sense**. The Sense variant adds a 6-axis IMU and a PDM microphone; the plain
  variant has neither. Both use the **same board target** below.

## Board Target
Use `xiao_nrf54lm20a/nrf54lm20a/cpuapp` as the build target.

## Board Availability — NOT in NCS by default (read this first)
This board is **not in the nRF Connect SDK**. Seeed's own guide states the board definitions "have not yet
been merged into the official NCS repository." It **is** in upstream Zephyr, but NCS bundles an older
Zephyr snapshot, so a stock NCS install cannot resolve `xiao_nrf54lm20a` out of the box.

To make it buildable:
1. Clone Seeed's board repo:
   ```
   git clone https://github.com/Seeed-Studio/platform-seeedboards.git
   ```
2. Point the Zephyr board root at `<cloned-repo>/zephyr`:
   - **nRF Connect for VS Code:** set the extension's board-root setting to that path.
   - **Command line:** pass `-DBOARD_ROOT=<cloned-repo>/zephyr` to `west build`, or set the `BOARD_ROOT`
     CMake variable.
3. The project also needs a devicetree overlay at `board/xiao_nrf54lm20a_nrf54lm20a_cpuapp.overlay` in the
   project folder — create it if scaffolding a new project for this board.

## NCS Version Compatibility — MUST CHECK before building
**Minimum NCS: v3.3.0.** Below NCS 3.1.1 this SoC is not supported at all. Support level also depends on
the silicon revision (Nordic compatibility matrix):

| Revision | NCS version(s) | Support level |
|---|---|---|
| Engineering A | 3.1.1 – 3.2.5 | Experimental |
| Engineering B | 3.3.0, 3.3.1 | Experimental |
| Engineering B | 3.4.0 LTS | Supported |
| Revision 1 | 3.3.0, 3.3.1, 3.4.0 LTS | Supported |

Before scaffolding or building for this board, check the installed NCS version (e.g. `nrfutil
toolchain-manager list`) and **warn the developer if it is below 3.3.0** — the board will not resolve at
all below that. NCS 3.4.0 LTS is the version where support stops being experimental (for Engineering B and
Revision 1 silicon); anything on 3.3.x is still experimental.

## Console / UART
- **TX:** P1.08
- **RX:** P1.09

## Flashing
Flash with `west flash`. The board exposes SWCLK/SWDIO, shared with an on-board SAMD11 companion chip. If
`west flash` cannot find a debugger, the fallback is an external SWD probe — for example an nRF52840 DK's
on-board J-Link, connected via debug-out. **Do not assume a UF2 bootloader** — there is no evidence of one
on this board.

## Bluetooth LE
This SoC's BLE stack supports **Channel Sounding** (from NCS 3.2.0 onward). Capability pointer only — see
`sdks/ncs/protocols/BLE.md` for general BLE stack knowledge.
