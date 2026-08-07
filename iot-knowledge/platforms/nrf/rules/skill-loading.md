---
id: adsum/nrf/rules/skill-loading
title: "nRF Platform Rule: Skill Loading"
type: knowledge
version: 1.4.0
owner: adsum-core
author: Omar Morceli
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
safety: [flash]
---

# nRF Platform Rule: Skill Loading (rules/skill-loading.md)

> **MANDATORY FIRST LOAD:** if the universal `rules/skill-loading.md` (`iot-knowledge/rules/skill-loading.md`)
> is not already in your context this task, `read_file` it now (Load-Once — skip if already loaded). It
> defines the Operation-Gating Principle, the Workflows-vs-Actions hierarchy, the Command Gate mechanics,
> and Load-Once Optimization — shared verbatim across nRF and ESP. **This file has ONLY the nRF-specific
> tables, Command Gate rationale, and worked examples** — it does not restate the general framework.

---

## Operation → Workflow

This table is organized by what you, the agent, are about to *do* — not by what the user typed. Use it the moment you recognize the upcoming operation.

| About to do (the operation) | Workflow to load first |
|---|---|
| **One-click demo** — task starts with `Demo:` or contains `[ADSUM_DEMO:` | Load `platforms/nrf/workflows/demo-debug.md` and follow it. The task message provides real file paths — use `read_file` on each. Do not connect to devices. |
| **Scaffold a new nRF prototype** — task contains `scaffold a new nRF prototype` or `Start a new nRF/Zephyr prototype` | `platforms/nrf/workflows/prototype.md` |
| **Add a feature to an existing project** — task contains `add a feature` or `Add a feature to` | `platforms/nrf/workflows/add-feature.md` |
| **Test or validate firmware** — task contains `test and validate` or `Prove` + `works` | `platforms/nrf/workflows/test-validate.md` |
| Build firmware · Flash firmware · run the Build → Flash → Capture → Analyze → Fix iteration cycle | `platforms/nrf/workflows/debug-loop.md` |
| Capture device logs (UART/RTT) · perform log analysis · diagnose runtime behaviour from logs | `platforms/nrf/workflows/log-analyzer.md` |
| Inject `LOG_*` macros into source · configure the log backend in `prj.conf` · enable deep BLE stack logging · prepare a project for future log capture | `platforms/nrf/workflows/log-generator.md` |
| **Debug a BLE problem that app/stack logs don't explain** — pairing fails on one side · conn params won't update · PHY won't switch · GATT works on a phone but not a peer · a crash inside the controller · any timing-sensitive BLE bug | `platforms/nrf/workflows/hci-trace.md` (host↔controller HCI evidence) |
| **Anything about the BLE sniffer** — set up / flash / plug in the sniffer dongle, enter DFU, OR confirm what actually transmitted over the air (HCI shows a command went out but no result · "is the device even advertising / being connected to?" · range/interference) | `platforms/nrf/workflows/ble-sniffer.md` (it walks dongle setup + capture) |

If an upcoming operation does not match any row, you are not in a Workflow's scope and may proceed with standard tool use (consult `AGENT.md` Scope Gate first).

**BLE debugging is layered — do not skip to a guess.** For any BLE bug: app/stack logs first; if they don't explain it, you MUST escalate to **HCI** (`hci-trace`) before offering a root cause; if HCI shows a request went out but the outcome never came, escalate to the **air** (`ble-sniffer`). Never diagnose a BLE failure from general BLE knowledge when the matching curated workflow exists — load it.

---

## The Command Gate (nRF) — table

*(Mechanics — what a Command Gate is and why it fires — are defined once in the universal
`rules/skill-loading.md`. This table is the nRF-specific instance of it.)*

| About to do (any phrasing, any entry path) | Action file that MUST be in context |
|---|---|
| `west build` (any variant) | `platforms/nrf/actions/build.md` |
| `west flash` / `nrfutil device program` / any flashing | `platforms/nrf/actions/flash.md` |
| Capture device logs (`log_device`, any logger script) | `platforms/nrf/actions/capture-logs.md` |
| Open / read / interpret a captured log under `logs/` | `platforms/nrf/actions/analyze-logs.md` |
| A fault signature appears in a log | `platforms/nrf/actions/decode-fault.md` |
| **Read / interpret a decoded HCI monitor capture** (`logs/hci/*.hci.log` or a `.btmon`) | `platforms/nrf/actions/analyze-hci.md` (it loads `protocols/BLE/hci-monitor.md`) |
| **Read / interpret an over-the-air sniffer capture** (`logs/sniffer/*.sniffer.log` or a `.pcap`) | `platforms/nrf/actions/analyze-sniffer.md` (it loads `protocols/BLE/ota-sniffer.md`) |
| Run `twister` (simulator or `--device-testing`) | `platforms/nrf/actions/run-twister.md` |
| Pick a Nordic sample to copy or port from | `platforms/nrf/actions/find-sample.md` |
| Create/edit a CI workflow for firmware tests | `platforms/nrf/actions/setup-ci.md` |

**Why this is non-negotiable (nRF specifics):** sysbuild artifact paths, `--dev-id` (not the deprecated
`--snr`), per-DK VCOM mapping, the DTR tri-state rule, OS-aware Twister targets, pristine-build triggers —
none of these are derivable from general knowledge. (See the universal rule for why the Command Gate
mechanic itself is non-negotiable, and for the "capture without analysis" and Load-Once rules — both
apply here unchanged.)

---

## Worked Examples (nRF)

1. **User opens a fresh chat and says "flash my code to the nRF52832"** — you are about to flash → read `workflows/debug-loop.md`.
2. **You finished `log-analyzer` and the user says "ok now generate more logs"** — you are about to generate logs → read `workflows/log-generator.md`.
3. **Mid-conversation in `log-analyzer`, you discover the firmware was never flashed and the capture returned nothing useful** — you are about to flash → read `workflows/debug-loop.md`.
4. **You're inside `debug-loop` and it tells you to load `actions/build.md` via a `MANDATORY SKILL LOAD` directive** — the Workflow is invoking an Action; obey the directive.
5. **User asks an embedded question that doesn't match any operation in the table** (e.g., "explain what `CONFIG_BT_MAX_CONN` does") — no Workflow load needed; answer from your knowledge with the `AGENT.md` Scope Gate applied.
6. **You're deep in `prototype.md` and the scaffold is ready to build** — the Command Gate fires four times in sequence: `build.md` before `west build`, `flash.md` before flashing, `capture-logs.md` before capturing, `analyze-logs.md` before reading the captured file. Skipping any of these because "the prototype workflow is already loaded" is the failure this gate exists to prevent.
