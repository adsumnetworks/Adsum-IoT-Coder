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
    sha256: 8e71ae91e3d751fc6267f4ea656b03ad2b49fb4d9a45bec73f2518db32bd6508
---

Turn a crash dump's addresses into `file:line` on nRF and ESP: reads the fault frame, picks the addr2line for the chip's architecture, resolves the toolchain by absolute path and runs it. Pass the `.elf` of the exact build that was flashed — resolving it is the agent's job, because a glob picks the wrong image in a sysbuild or multi-app project. Refuses rather than guesses: a stack overflow, a watchdog and a brownout are reported as not-an-address-fault, and a missing toolchain exits 2 saying where it looked, never silently as "no fault found".
