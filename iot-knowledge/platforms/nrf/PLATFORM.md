---
id: adsum/nrf/platform
title: "Nordic nRF — Platform Index"
type: knowledge
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
safety: [flash]
---

# Nordic nRF — Platform Index (`platforms/nrf/`)

This file is the master index for the `platforms/nrf/` directory. It describes everything available for Nordic nRF development and tells the agent when and how to load each resource.

---

## Directory Map

```
platforms/nrf/
├── PLATFORM.md              ← You are here. Master index for the nRF platform.
├── rules/
│   ├── nrf-terminal.md      ← CRITICAL: Terminal routing rules (when to read: always)
│   ├── skill-loading.md     ← Skill discovery & loading rules (when to read: always)
│   └── device-identity.md   ← MANDATORY: Device role assignment (never guess roles)
├── boards/
│   ├── nrf52832.md          ← nRF52832 hardware specs & constraints
│   ├── nrf52840.md          ← nRF52840 hardware specs & constraints
│   └── nrf5340.md           ← nRF5340 dual-core specs & constraints
├── sdks/
│   └── ncs/
│       ├── SDK.md           ← NCS project structure, Kconfig, west build reference
│       └── protocols/
│           └── BLE.md       ← BLE stack concepts, log modules, buffer tuning
├── scripts/                 ← Internal helper scripts (do not modify)
├── actions/                 ← Internal subroutines (load ONLY when a Workflow instructs)
│   ├── build.md
│   ├── flash.md
│   ├── capture-logs.md
│   └── analyze-logs.md
└── workflows/               ← Primary entry points (START HERE for each task)
    ├── log-generator.md
    ├── log-analyzer.md
    ├── debug-loop.md
    ├── demo-debug.md
    ├── prototype.md         ← SCAFFOLD: new project from verified Nordic sample
    ├── add-feature.md       ← SCAFFOLD: add a Zephyr feature to existing project
    └── test-validate.md     ← SCAFFOLD: simulator (native_sim/QEMU, OS-aware) + on-hardware validation
```

---

## Rules (`rules/`)

Rules are platform-specific constraints that override the agent's default behavior. See `rules/skill-loading.md` for the full Skill Discovery Protocol.

| File | When to Load | Purpose |
|---|---|---|
| `rules/nrf-terminal.md` | **Always.** | ALL NCS/SDK commands must use `nrf_device_tool`, never `execute_command`. |
| `rules/skill-loading.md` | **Always.** | Skill hierarchy: Workflows are entry points, Actions are internal subroutines. |
| `rules/device-identity.md` | **Always.** | NEVER guess device roles. Use `device1`/`device2` until confirmed by config or logs. |

---

## Hardware (`boards/`)

Load the board file when the project targets a specific SoC. Each file documents key hardware constraints (RAM, Flash, peripherals, known limitations).

| Board Target | SoC | File |
|---|---|---|
| `nrf52840dk/nrf52840` | nRF52840 | `boards/nrf52840.md` |
| `nrf52dk/nrf52832` | nRF52832 | `boards/nrf52832.md` |
| `nrf5340dk/nrf5340/cpuapp` | nRF5340 | `boards/nrf5340.md` |

Board targets use the Zephyr format: `<board>/<soc>` (e.g., `nrf52840dk/nrf52840`).

---

## SDKs (`sdks/`)

| SDK | File | When to Load |
|---|---|---|
| Nordic Connect SDK (NCS) + Zephyr RTOS | `sdks/ncs/SDK.md` | Load on first NCS project task. Contains project structure, Kconfig reference, west commands. |
| BLE Stack | `sdks/ncs/protocols/BLE.md` | Load when the project uses BLE (`CONFIG_BT=y`) or when debugging BLE-related issues. |

---

## Platform Tools — `triggerNordicAction`

The `triggerNordicAction` is the agent's primary interface for all hardware operations. It wraps the nRF Connect Terminal and device tools.

**Do NOT expose internal tool names to the user.** Say *"Building firmware..."* not *"Running triggerNordicAction with action=execute"*.

### `action="execute"` — Run NCS/SDK Commands

Executes any command inside the nRF Connect Terminal (which has `ZEPHYR_BASE`, `west`, `cmake`, etc. pre-loaded). See `rules/nrf-terminal.md` for full routing rules.

**Key commands:**
- `west build -b <board>/<soc>` — Build firmware
- `west flash` — Flash firmware to device
- `nrfutil toolchain-manager list` — Show installed NCS SDK versions

### `action="execute"` — Device Discovery (Two-Step Sequence)

Before building or flashing, the agent MUST identify the connected hardware:

**Step 1:** List all connected devices
```
triggerNordicAction: action="execute", command="nrfutil device list"
```
→ Returns serial numbers, ports, and device traits.

**Step 2:** Get detailed device info for board/SoC identification
```
triggerNordicAction: action="execute", command="nrfutil device device-info --serial-number <SN1,SN2,...,SNn>"
```
→ Returns `deviceFamily`, `deviceName`, `deviceVersion`. Use this to determine the correct `<board>/<soc>` target for `west build`.

**Auto-Install Guard:**
- If `nrfutil device` fails: `nrfutil install device`
- If `nrfutil toolchain-manager` fails: `nrfutil install toolchain-manager`

### `action="log_device"` — Live Log Capture

Captures live device logs via RTT or UART. Used by `actions/capture-logs.md`.

**Single device:**
```
triggerNordicAction: action="log_device", operation="capture", transport="rtt", port="<serial_number>", duration="<seconds>"
```

**Multi-device simultaneous capture:**
```
triggerNordicAction: action="log_device", operation="capture", transport="rtt", devices="device1:<sn1>,device2:<sn2>", duration="<seconds>"
```
Use generic labels (`device1`, `device2`) until roles are confirmed. See `rules/device-identity.md`.

**Boot log capture (with reset):**
```
triggerNordicAction: action="log_device", operation="capture", transport="rtt", port="<sn>", duration="15", pre-capture-delay="3", reset="true"
```

---

## Skill Library Index

The workflows and actions below are strict, custom-built skills. See `rules/skill-loading.md` for the mandatory loading protocol.

### Primary Entry-Point Workflows (START HERE)

When starting a new task, load one of these Workflows first.

| Workflow Name | Documentation File (Use `read_file`) | Purpose |
|---|---|---|
| Log Generator | `workflows/log-generator.md` | Add Zephyr logging instrumentation to firmware |
| Log Analyzer | `workflows/log-analyzer.md` | Guided sequence to capture and analyze device logs |
| Debug Loop | `workflows/debug-loop.md` | Iterative Build → Flash → Capture → Analyze cycle |
| Prototype | `workflows/prototype.md` | Compose a new nRF project from verified Nordic samples |
| Add Feature | `workflows/add-feature.md` | Port one feature into an existing project, then verify via Debug Loop |
| Test & Validate | `workflows/test-validate.md` | ztest via simulator/on-hardware Twister + behavioral validation + CI offer |

### Internal Actions (loaded when a Workflow instructs, or the Command Gate in `rules/skill-loading.md` fires)

| Action | File | Purpose |
|---|---|---|
| Build | `actions/build.md` | Building firmware (`west build`) |
| Flash | `actions/flash.md` | Flashing firmware to device (`west flash`) |
| Capture Logs | `actions/capture-logs.md` | Capturing live RTT/UART device logs |
| Analyze Logs | `actions/analyze-logs.md` | Analyzing a captured log file |
| Find Sample | `actions/find-sample.md` | Map a capability to the verified Nordic sample to copy/port |
| Run Twister | `actions/run-twister.md` | Build + run ztest suites (OS-aware simulator target or `--device-testing`) |
| Decode Fault | `actions/decode-fault.md` | Symbolize a fault's PC/LR to `file:line` via addr2line |
| Set Up CI | `actions/setup-ci.md` | GitHub Actions: build + native_sim Twister on every PR |
