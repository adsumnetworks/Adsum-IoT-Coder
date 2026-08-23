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
    sha256: f5a88d007fb5e6dc36825fc14f192e21d61f9b93a0188ba7c80184f3e7ee923a
  - path: uart-logger
    sha256: 48f06b49fd995e62ec6aa284b66abb4add031dff0bffa376be9aa85e223859ca
  - path: uart-logger.bat
    sha256: 41ab965e6af7aa2f5fc7ab4f88024bd248690a446c48acd3cad2db34174718c4
---

Capture UART output from an nRF target to a log file.
