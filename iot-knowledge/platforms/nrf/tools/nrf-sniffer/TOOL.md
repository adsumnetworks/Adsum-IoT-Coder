---
id: adsum/nrf/tools/nrf-sniffer
title: "nrf-sniffer"
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
entry: nrf_sniffer.py
usage: '--capture --duration <SECONDS> --out <FILE.pcap>'
safety: [shell]
readonly: false
requires_tools: [nrfutil]
artifacts:
  - path: nrf-sniffer
    sha256: 8b42d1f946df4a1b2294ce1e5fb0cbc064f2feb35f37e43bd0e6e205e10c352b
  - path: nrf-sniffer.bat
    sha256: febe7e741799520b64da464454411d3ef922741281cb1f9b03dbc790deb48bce
  - path: nrf_sniffer.py
    sha256: aa63291e1363b525897fbe4598955cf05aff03b5a9f5d6a2a7a442a955ae9546
---

Capture Bluetooth LE traffic with an nRF52840 dongle running sniffer firmware, to a .pcap.
