---
id: adsum/tools/decode-fault
title: "decode-fault"
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
min_ext: "0.3.0"
runtime: node
entry: decode_fault.mjs
usage: '--elf <path> [--log <path>] [--platform nrf|esp] [--chip <target>] [--json]'
safety: []
readonly: true
artifacts:
  - path: decode_fault.mjs
    sha256: 799801e5351fa36ac300c6fc89693ff4bde92d3f9136d49aee623871a995b27d
---

Turn a crash dump's addresses into `file:line` on nRF and ESP: reads the fault frame, picks the addr2line for the chip's architecture, resolves the toolchain by absolute path and runs it. Pass the `.elf` of the exact build that was flashed — resolving it is the agent's job, because a glob picks the wrong image in a sysbuild or multi-app project. Refuses rather than guesses: a stack overflow, a watchdog and a brownout are reported as not-an-address-fault, and a missing toolchain exits 2 saying where it looked, never silently as "no fault found".
