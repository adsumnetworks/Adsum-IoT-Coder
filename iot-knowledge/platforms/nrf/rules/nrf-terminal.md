---
id: adsum/nrf/rules/nrf-terminal
title: "nRF Platform Rule: nRF Connect Terminal"
type: knowledge
version: 1.1.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
safety: [flash, process-kill]
---

# nRF Platform Rule: nRF Connect Terminal (rules/nrf-terminal.md)

**ALL NCS SDK/toolchain commands MUST be run with `nrf_device_tool` (`action="execute"` for west/nrfutil/nrfjprog, `action="log_device"` for RTT/UART capture).** Never use `execute_command` for NCS tasks — it runs in a plain terminal with no toolchain.

## How it runs (you don't manage the terminal)

`nrf_device_tool` runs your command in **its own terminal** and **sources the right NCS toolchain in the background**, so you only ever issue the clean dev command. You do **not** open the nRF Connect terminal, pick a version, or source any environment script — the tool does all of that for you.

```xml
<nrf_device_tool>
  <action>execute</action>
  <command>west build -b nrf52840dk/nrf52840 .</command>
</nrf_device_tool>
```

If the tool can't source the toolchain itself, it automatically falls back to the nRF Connect extension's terminal. You never trigger that fallback by hand.

## NCS version selection

The tool picks the NCS version automatically: the project's existing build → the only installed version → otherwise it **asks once**. If it returns a message that several NCS versions are installed and the project has no build yet, **ask the user which version**, then re-run with `ncs_version="vX.Y.Z"`. The choice is remembered for this project, so you won't be asked again. You do **not** need `ncs_version` in the normal case.

## Shell syntax — one command per invocation (Windows trap)

Commands run in the user's own shell (PowerShell on Windows, bash/zsh on macOS/Linux). Do not chain.

| Never | Why | Instead |
|---|---|---|
| `cmd1 && cmd2` | fails on Windows PowerShell 5.x | **one command per invocation** |
| `cmd1 & cmd2` | `&` is not allowed in PowerShell | one command per invocation |
| `echo $ZEPHYR_BASE` / `echo %ZEPHYR_BASE%` | env-probing tells you nothing | run the real command (e.g. `west --version`) — that **is** the check |
| `set X=...`, `2>nul` | cmd-only semantics | wrap an unavoidable cmd-ism as `cmd /c "..."` |

- **One command per invocation on every OS.** You read each result before the next step, so chaining only hides which part failed.
- **Don't probe the environment.** The toolchain is already sourced for you; running the actual command is the verification.

## Use `nrf_device_tool` for
- `west build`, `west flash`, `west debug`, `west boards`, `west build -t menuconfig`
- Any `nrfutil` / `nrfjprog` command (`action="execute"`)
- Device enumeration → `action="log_device"` `operation="list"` (never `nrfutil device list` via `execute_command`)
- RTT/UART log capture → `action="log_device"`

## Use `execute_command` (plain terminal) for
- `git` (commit, push, status)
- Host package managers: `pip install`, `apt install`
- File search/read → prefer built-in tools (`read_file`, `search_files`, `list_files`)
- General one-off host OS operations

## Prerequisites
- The **nRF Connect for VS Code** extension installed, with at least one NCS toolchain (Manage SDKs / Manage Toolchains, or `nrfutil sdk-manager install vX.Y.Z`).
- If a build fails with "toolchain not found" / no NCS installed, tell the user to install an SDK version, then retry. Do not hand-source any environment script.
