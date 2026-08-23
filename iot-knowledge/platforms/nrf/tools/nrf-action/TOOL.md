---
id: adsum/nrf/tools/nrf-action
title: "nrf-action"
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
runtime: host
host_tool: triggerNordicAction
usage: 'action="execute|log_device|sniff_capture|open_capture" [...]'
safety: [flash, erase, process-kill]
readonly: false
---

Built into the extension. Runs NCS/Zephyr work in a terminal with the right toolchain already sourced, so the agent only ever issues the clean dev command — `west`, `nrfutil`, `nrfjprog` via `action="execute"` — and drives RTT/UART capture and BLE sniffing through the logger Tool bits. The model calls it as `triggerNordicAction`, and that is the only name for it — the corpus once used three, and `kbit:lint` now fails any bit body that reaches for one of the others.
