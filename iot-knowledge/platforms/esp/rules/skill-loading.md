---
id: adsum/esp/rules/skill-loading
title: "ESP Platform Rule: Skill Loading"
type: knowledge
version: 1.2.0
owner: adsum-core
author: Omar Morceli
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: esp
---

# ESP Platform Rule: Skill Loading (rules/skill-loading.md)

> **MANDATORY FIRST LOAD:** if the universal `rules/skill-loading.md` (`iot-knowledge/rules/skill-loading.md`)
> is not already in your context this task, `read_file` it now (Load-Once — skip if already loaded). It
> defines the Operation-Gating Principle, the Workflows-vs-Actions hierarchy, the Command Gate mechanics,
> and Load-Once Optimization — shared verbatim across nRF and ESP. **This file has ONLY the ESP-specific
> tables, Command Gate rationale, and worked examples** — it does not restate the general framework.
> Note specific to ESP-IDF: the ESP-IDF API and `idf.py` surface change between versions, so the Workflow
> (not pre-trained knowledge) is the source of truth for steps, gates, and error handling.

## Operation → Workflow

This table is organized by what you, the agent, are about to *do* — not by what the user typed.

| About to do (the operation) | Workflow to load first |
|---|---|
| **Scaffold a new ESP-IDF prototype** — task contains `scaffold a new ESP-IDF prototype` or `Start a new ESP-IDF prototype` | `platforms/esp/workflows/prototype.md` |
| **Add a feature to an existing project** — task contains `add a feature` or `Add a feature to` | `platforms/esp/workflows/add-feature.md` |
| **Test or validate firmware** — task contains `test and validate` or `Prove` + `works` | `platforms/esp/workflows/test-validate.md` |
| Build firmware · Flash firmware · run the Build → Flash → Capture → Analyze → Fix cycle · diagnose a crash/panic/WDT/brownout | `platforms/esp/workflows/debug-loop.md` |
| Capture serial logs · analyze logs · diagnose runtime behaviour on a board **already running** (no reflash) | `platforms/esp/workflows/log-analyzer.md` |
| Add `ESP_LOG*` instrumentation to existing source · prepare a project for future log capture | `platforms/esp/workflows/log-generator.md` |
| **Debug a Wi-Fi / networking problem** — won't connect, auth/DHCP fails, drops, low throughput, can't reach a server | `platforms/esp/workflows/debug-loop.md` — **and** load `sdks/esp-idf/protocols/WIFI.md` for the failure-mode reference (see the Command Gate). |

If an upcoming operation matches no row, you are not in a Workflow's scope — answer from knowledge with the `AGENT.md` Scope Gate applied.

**Protocol bugs use the curated protocol bit, not general knowledge.** Before you diagnose a Wi-Fi or BLE problem, the matching protocol reference (`protocols/WIFI.md` / `protocols/BLE.md`) MUST be in your context — the Command Gate below enforces it. These carry version-pinned failure modes you cannot reliably derive from pre-training.

## The Command Gate (ESP) — table

*(Mechanics — what a Command Gate is and why it fires, and the Workflows-vs-Actions hierarchy — are
defined once in the universal `rules/skill-loading.md`. This table is the ESP-specific instance of it.)*

| About to do (any phrasing, any entry path) | Action file that MUST be in context |
|---|---|
| `idf.py build` (any variant) | `platforms/esp/actions/build.md` |
| `idf.py flash` / any flashing | `platforms/esp/actions/flash.md` |
| Capture serial logs (`action="monitor"`) | `platforms/esp/actions/capture-logs.md` |
| Open / read / interpret a captured log under `logs/` | `platforms/esp/actions/analyze-logs.md` |
| A panic / `Guru Meditation` backtrace appears in a log | `platforms/esp/actions/decode-fault.md` |
| **Diagnose a Wi-Fi problem** (connect / auth / DHCP / disconnect / throughput) | `platforms/esp/sdks/esp-idf/protocols/WIFI.md` |
| **Diagnose a BLE (NimBLE) problem** | `platforms/esp/sdks/esp-idf/protocols/BLE.md` |
| Change a Kconfig value (`sdkconfig` / `sdkconfig.defaults`) | `platforms/esp/actions/configure.md` |
| Run Unity tests (host `linux` / QEMU / on-hardware pytest) | `platforms/esp/actions/run-tests.md` |
| Pick an IDF example / registry component to copy or pull from | `platforms/esp/actions/find-sample.md` |
| Create/edit a CI workflow for firmware build/tests | `platforms/esp/actions/setup-ci.md` |

**Why this is non-negotiable (ESP specifics):** target reconciliation, the `sdkconfig` vs
`sdkconfig.defaults` trap, the always-pass-the-port rule, monitor's backtrace decode, the
Xtensa-vs-RISC-V `addr2line` prefix, the `linux`/QEMU tier split — none of these are derivable from
general knowledge. (See the universal rule for why the Command Gate mechanic itself is non-negotiable,
and for the "capture without analysis" and Load-Once rules — both apply here unchanged.)

## Worked Examples
1. **Fresh chat: "flash my code to the esp32-s3"** → about to flash → read `workflows/debug-loop.md`.
2. **"build me a wifi sensor dashboard from scratch"** → about to scaffold a prototype → read `workflows/prototype.md`.
3. **Mid-analysis you find the firmware was never flashed** → about to flash → read `workflows/debug-loop.md`.
4. **Inside debug-loop, it says load `actions/build.md` via MANDATORY SKILL LOAD** → obey the directive.
5. **"what does CONFIG_FREERTOS_HZ do?"** → matches no operation → answer directly, Scope Gate applied.
6. **You're deep in `prototype.md` and the scaffold is ready to build** — the Command Gate fires in sequence: `build.md` before `idf.py build`, `flash.md` before flashing, `capture-logs.md` before capturing, `analyze-logs.md` before reading the captured file. Skipping any because "the prototype workflow is already loaded" is the failure this gate exists to prevent.
