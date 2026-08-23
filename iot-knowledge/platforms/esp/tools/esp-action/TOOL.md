---
id: adsum/esp/tools/esp-action
title: "esp-action"
type: tool
version: 1.0.0
owner: adsum-core
author: Omar Morceli
license: Apache-2.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: esp
min_ext: "0.3.0"
runtime: host
host_tool: triggerEspAction
usage: 'action="build|flash|monitor|clean|set_target|execute|capture_logs" [...]'
safety: [flash, erase, process-kill]
readonly: false
---

Built into the extension. Runs ESP-IDF work inside a terminal that already has the IDF environment sourced — build, flash, monitor, set-target, clean, and arbitrary commands via `action="execute"`. The model calls it as `triggerEspAction`; it is never fetched, because it is the extension's own code. Listed here so the procedures that drive it can declare what they depend on, and so its author is credited like any other tool's.
