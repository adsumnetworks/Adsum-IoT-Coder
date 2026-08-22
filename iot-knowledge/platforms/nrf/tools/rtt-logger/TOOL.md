---
id: adsum/nrf/tools/rtt-logger
title: "rtt-logger"
type: tool
version: 1.0.0
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
usage: '--capture --port <PORT> --duration <SECONDS> --out <FILE>'
safety: [shell]
readonly: false
artifacts:
  - path: nrf_rtt_logger.py
    sha256: fe9be514b139d1ccb85da8ae496f95238df6456581f2ca401f7eda79a26b1c82
  - path: rtt-logger
    sha256: 4f167f33a7e523e59f7ecf28abd2373298cf1b82f5771fe59463d5148f304b0b
  - path: rtt-logger.bat
    sha256: 9b5024b44be1a2b48faa41b4187f22d3fc876bf22dc11a58433caa3c780816a3
---

Capture Segger RTT output from a running nRF target to a log file.
