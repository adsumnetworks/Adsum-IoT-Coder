---
id: adsum/esp/tools/esp-monitor
title: "esp-monitor"
type: tool
version: 1.3.1
owner: adsum-core
author: Omar Morceli
license: Apache-2.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: esp
min_ext: "0.3.0"
runtime: python3
entry: esp_monitor_logger.py
usage: '--port <PORT> --duration <SECONDS> --out <FILE>'
safety: [shell]
readonly: false
artifacts:
  - path: esp-monitor
    sha256: 4c775e0ff2698f38dbdb3ccf7ab13b9a959537f87d940e350d8c73ff4f663fda
  - path: esp-monitor.bat
    sha256: 78a3e52cdec40d9f4b3a1616bf9b5b8218a5a53440f142ddc34d085aa4bb1ffc
  - path: esp_monitor_logger.py
    sha256: f14727ef8efb0e62c4f79782c5ad19074ade1387fdbe5a99de525bece0278133
---

Capture ESP32 serial monitor output to a log file, with the boot banner intact.

A capture reads the board as it is running and **does not reset it**: `idf.py monitor` is run with
`--no-reset` and the port, and the raw fallback opens the port without touching DTR/RTS. `--reset` (the
`reset="true"` parameter) is an explicit opt-in that reboots the board first, for a boot sequence on a board
the developer has confirmed, or one just flashed in the same task. With no port found, nothing is captured
rather than risk a reset. `--no-reset` wins over `--reset`.
