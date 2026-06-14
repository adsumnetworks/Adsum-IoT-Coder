---
id: adsum/nrf/rules/nrf-terminal
title: "nRF Platform Rule: nRF Connect Terminal"
type: knowledge
version: 1.0.0
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

**ALL NCS SDK/toolchain commands MUST be executed using `nrf_device_tool` with `action="execute"`.**

The nRF Connect terminal pre-loads the Zephyr/NCS toolchain environment (`ZEPHYR_BASE`, `GNUARMEMB_TOOLCHAIN_PATH`, `west`, `cmake`, `ninja`, etc.). Running commands in a plain terminal will **FAIL** because the environment is not configured.

## How to Execute NCS Commands

**ALWAYS use `nrf_device_tool` with `action="execute"`:**

```xml
<nrf_device_tool>
  <action>execute</action>
  <command>west build -b nrf52840dk/nrf52840 .</command>
</nrf_device_tool>
```

**NEVER use `execute_command` for NCS SDK tasks.** It runs in a plain terminal without `ZEPHYR_BASE`.

## Shell Syntax — match the shell, don't guess (Windows trap)

On Windows the nRF Connect terminal is **PowerShell**, not cmd. cmd-only syntax **errors hard** there:

| Never (cmd-only) | Breaks in PowerShell with | Instead |
|---|---|---|
| `echo %ZEPHYR_BASE%` | prints the literal `%ZEPHYR_BASE%` | don't probe env at all — see below |
| `cmd1 & cmd2` | `The ampersand (&) character is not allowed` | **one command per invocation** |
| `cmd1 && cmd2` | fails on PowerShell 5.x | one command per invocation |
| `set X=...`, `2>nul` | wrong/ignored semantics | PowerShell forms, or wrap: `cmd /c "..."` |

- **One command per invocation is the rule on every OS.** You read each result before the next step anyway — chaining only hides which part failed.
- **Don't probe the environment.** Never run `echo $ZEPHYR_BASE` / `echo %ZEPHYR_BASE%` to "check the env". In the nRF Connect terminal the env is pre-loaded — running the actual command (e.g. `west --version`) **is** the check. If it fails, the terminal setup is broken (see Prerequisites), not your syntax.
- If a cmd-ism is genuinely unavoidable (e.g. `taskkill ... 2>nul`), wrap the whole thing: `cmd /c "..."`.

## Terminal State Check

Before running commands, the tool will:
1. **Check** if an existing nRF terminal is open and active → use it directly.
2. **Activate** existing nRF terminal if it is not the active one → bring it to focus.
3. **Create** a new nRF Connect terminal via the extension → wait for it to initialize.

## Commands that MUST use `nrf_device_tool`
- `west build`, `west flash`, `west debug`
- `nrfutil device list`, `nrfutil device device-info`
- `nrfutil toolchain-manager list`
- `west build -t menuconfig`
- Any `nrfjprog` command
- Any `nrfutil` command

## Commands that use `execute_command` (standard terminal)
- `git` commands (commit, push, status)
- Host package managers: `pip install`, `apt install`
- **File search/read tasks → prefer built-in tools** (`read_file`, `search_files`, `list_files`) over shell commands.
- General one-off host OS operations

## The `source` Workaround (Last Resort ONLY)

If `nrf_device_tool` cannot open the nRF Connect terminal (extension not installed or failing), use this workaround as a last resort. Document the attempt and ask the user to fix the extension afterward.

```bash
source ~/ncs/v3.2.1/zephyr/zephyr-env.sh && export ZEPHYR_BASE=~/ncs/v3.2.1/zephyr && \
export GNUARMEMB_TOOLCHAIN_PATH=~/ncs/toolchains/43683a87ea && \
export PATH=~/ncs/toolchains/43683a87ea/opt/bin:$PATH && \
west build -b nrf52840dk/nrf52840 .
```

> **Do NOT use this workaround as the default.** It is only acceptable when the nRF Connect extension is confirmed broken. Always try `nrf_device_tool` first. it's good to ask the user if he wants to use this workaround.

## Prerequisites
- The **nRF Connect for VS Code** extension must be installed and configured.
- If `west --version` or `nrfutil --version` fails inside the nRF Connect terminal, the user must fix the extension setup before any development can proceed.
- If `nrfutil device` fails, install it: `nrfutil install device`
- If `nrfutil toolchain-manager` fails, install it: `nrfutil install toolchain-manager`
