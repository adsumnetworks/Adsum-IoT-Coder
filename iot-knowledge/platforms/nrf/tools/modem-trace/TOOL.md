---
id: adsum/nrf/tools/modem-trace
title: "modem-trace"
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
entry: modem_trace.py
usage: '--decode <trace.bin> --out <dir>'
safety: [shell]
readonly: false
artifacts:
  - path: modem-trace
    sha256: ec328de2d3ebf3f874d2fcd723486795046afb2fd7a4c656b2ca2b0f8c9c6732
  - path: modem-trace.bat
    sha256: 95e0bcf1eaab0b77d383f1456b1bf00802621c41af428019a7f38fc046132291
  - path: modem_trace.py
    sha256: e79ed79c98fd2768ecce91f3d92d97ac6d3511ed49f0b256ddc718315dc61298
---

Decode an nRF91 modem trace and explain the AT dialogue in English.
