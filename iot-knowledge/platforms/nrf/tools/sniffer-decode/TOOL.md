---
id: adsum/nrf/tools/sniffer-decode
title: "sniffer-decode"
type: tool
version: 1.0.0
owner: adsum-core
author: Omar Morceli
co_authors:
  - handle: ismail-hamdad
    name: Ismail Hamdad
license: Apache-2.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
min_ext: "0.3.0"
runtime: node
entry: sniffer_decode.mjs
usage: '--in <capture.pcap> [--json]'
safety: []
readonly: true
artifacts:
  - path: sniffer_decode.mjs
    sha256: d8c2570e4ce8711e407a2a77c622e7a5f2e4f30b4e32b0f593c57cb0573441d5
---

Decode a Nordic BLE sniffer PCAP into a readable over-the-air trace: advertising, CONNECT_IND, LL control and data frames with a key-frame timeline. Reports `totalFrames: 0` when the dongle saw no traffic — a real result, distinct from an EMPTY capture file, which is reported as a capture failure instead.
