---
id: adsum/nrf/tools/rtt-logger
title: "rtt-logger"
type: tool
version: 1.1.2
owner: adsum-core
author: Omar Morceli
license: Apache-2.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
min_ext: "0.3.0"
runtime: python3
entry: nrf_rtt_logger.py
usage: '--capture --port <PORT> --duration <SECONDS> --out <FILE>   # or --output <DIR> for several devices'
safety: [shell]
readonly: false
artifacts:
  - path: nrf_rtt_logger.py
    sha256: 7729ef75f3cf0e2c9aee0d6afc45f5f3ca0cd3b70ea8662aa1b4a530707c0eb0
  - path: rtt-logger
    sha256: 4f167f33a7e523e59f7ecf28abd2373298cf1b82f5771fe59463d5148f304b0b
  - path: rtt-logger.bat
    sha256: 9b5024b44be1a2b48faa41b4187f22d3fc876bf22dc11a58433caa3c780816a3
---

Capture Segger RTT output from a running nRF target to a log file.

A capture reads the target as it is running and **does not reset it**. `--reset` (the `reset="true"`
parameter) is an explicit opt-in: it reboots the target before recording, so use it only to record a
boot sequence on a device the developer has confirmed is the one under discussion. A capture taken
with a reset is not a reading of what the device was doing before it. `--no-reset` is the default and
wins over `--reset`.

