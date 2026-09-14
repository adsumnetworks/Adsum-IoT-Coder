---
id: adsum/nrf/tools/uart-logger
title: "uart-logger"
type: tool
version: 1.0.3
owner: adsum-core
author: Omar Morceli
license: Apache-2.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
min_ext: "0.3.0"
runtime: python3
entry: nrf_uart_logger.py
usage: '--capture --port <PORT> --duration <SECONDS> --out <FILE>   # or --output <DIR> for several devices'
safety: [shell]
readonly: false
artifacts:
  - path: nrf_uart_logger.py
    sha256: 2967566a7ed51ef226ff367b239f9ab71d16bb4b4d9039b0b9f8b1107d56c44b
  - path: uart-logger
    sha256: 48f06b49fd995e62ec6aa284b66abb4add031dff0bffa376be9aa85e223859ca
  - path: uart-logger.bat
    sha256: 41ab965e6af7aa2f5fc7ab4f88024bd248690a446c48acd3cad2db34174718c4
---

Capture UART output from an nRF target to a log file.

A capture reads the target as it is running and **does not reset it**. `--reset` (the `reset="true"`
parameter) is an explicit opt-in: it reboots the target before recording, so use it only to record a
boot sequence on a device the developer has confirmed is the one under discussion. A capture taken
with a reset is not a reading of what the device was doing before it. `--no-reset` is the default and
wins over `--reset`.
