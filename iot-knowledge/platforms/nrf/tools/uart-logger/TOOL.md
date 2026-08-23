---
id: adsum/nrf/tools/uart-logger
title: "uart-logger"
type: tool
version: 1.0.1
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
usage: '--capture --port <PORT> --duration <SECONDS> --out <FILE>'
safety: [shell]
readonly: false
artifacts:
  - path: nrf_uart_logger.py
    sha256: dcc05c45378dccee3cfaf785be669ada3d6a3c22acf762d48103b2341c34d065
  - path: uart-logger
    sha256: 48f06b49fd995e62ec6aa284b66abb4add031dff0bffa376be9aa85e223859ca
  - path: uart-logger.bat
    sha256: 41ab965e6af7aa2f5fc7ab4f88024bd248690a446c48acd3cad2db34174718c4
---

Capture UART output from an nRF target to a log file.
