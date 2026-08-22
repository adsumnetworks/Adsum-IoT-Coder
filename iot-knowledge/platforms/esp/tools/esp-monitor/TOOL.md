---
id: adsum/esp/tools/esp-monitor
title: "esp-monitor"
type: tool
version: 1.0.0
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
    sha256: edc2855f62b6b7d36b19c91d45dc1abc05a0435b77de9170c5871452616bfceb
---

Capture ESP32 serial monitor output to a log file, with the boot banner intact.
