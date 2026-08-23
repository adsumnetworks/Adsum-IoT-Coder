---
id: adsum/nrf/tools/hci-decode
title: "hci-decode"
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
entry: hci_decode.mjs
usage: '--in <capture.btmon> [--json]'
safety: []
readonly: true
artifacts:
  - path: hci_decode.mjs
    sha256: 13e86f598b9f954337fa9dc4905743734b42bc6ecbaae2234bae09b498633311
  - path: NOTICE
    sha256: ed76bc9197767435d198e09bd4e3d66e1d28ca35fd044a444b7f0ac15fb6c9f0
---

Decode a btmon capture (`CONFIG_BT_DEBUG_MONITOR_RTT=y` on Zephyr / NCS) into a readable HCI trace: commands, events and ACL traffic with their decoded fields, plus a connection timeline. An empty capture is reported as a capture failure, not as a trace with no packets in it. Carries the MIT notice for the LogScope-derived decoder as a declared member.
