---
id: adsum/rules/tool-routing
title: "Tool Routing Directives"
type: knowledge
version: 1.3.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: universal
---

# Tool Routing Directives

Standard shell terminals on embedded development machines often lack the cross-compiler, toolchain, and SDK environment variables needed for firmware operations.

## Global Routing Principles

1. **Platform Terminal for SDK Commands**
   Each platform has a designated terminal that pre-loads its toolchain environment. All build, flash, and device-query commands MUST use that terminal.
   - Refer to `platforms/<platform>/rules/` for which terminal to use.
   - Refer to `platforms/<platform>/PLATFORM.md` for available CLI tools.

2. **`execute_command` for Host Operations**
   Use `execute_command` (standard terminal) for:
   - General host system operations: `git`, file manipulation, text/regex search (see #5 for shell-aware syntax)
   - Standard package managers: `npm`, `pip`, `apt`
   - Any operation that does not need the SDK toolchain environment

3. **Dedicated Device Tools for Specialized Hardware Operations**
   Some operations require dedicated tools that go beyond simple CLI commands (e.g., live log capture with multi-device synchronization, reset coordination, transport auto-detection).
   - Refer to `platforms/<platform>/PLATFORM.md` for which dedicated tools are available and what they do.
   - These tools handle complexity that shell commands alone cannot (e.g., simultaneous multi-device RTT capture with file naming).

   **A Device tool's NAME is not a command on your PATH.** The "Device tools" block lists each one as
   **name** followed by the exact command to run — usually an absolute interpreter path and script path,
   e.g. `- **posture-scan** — <absolute path to node> <absolute path to posture_scan.mjs> --platform nrf|esp …`.
   Those paths look different on Windows, macOS and Linux; copy what the block gives you rather than
   reconstructing one.
   Knowledge bits refer to a tool by that NAME and write usage as `name --args`. That is shorthand for the
   advertised line, not something you can type.
   - **Find the tool by NAME in the block, then copy its command VERBATIM** and append your arguments.
   - **Never conclude a tool is unavailable because its bare name failed.** `posture-scan` on its own is
     "command not found" on every machine — that says nothing about whether the tool is there.
   - Only a line carrying a ⚠ prerequisite is genuinely unavailable. Tell the developer what is missing;
     do not write your own script in its place.
   - A bit that offers a fallback "if the tool is not advertised" means *not present in the block at all* —
     not "the name did not run".

4. **Never Mix Terminals**
   A command that works in `execute_command` may NOT work in a platform terminal, and vice-versa. Do not assume cross-compatibility.

5. **Shell-aware syntax — you may be on Windows PowerShell.**
   `execute_command` runs in the developer's actual shell. **Check the environment — on Windows it is PowerShell**, where POSIX tools/syntax do **not** exist (`grep`, `cat`, `find`, `2>/dev/null`, `dir /s /b`, `type` all fail or differ). Use the right form for the shell:
   - **Search a file for symbols/patterns:** POSIX `grep -E 'pat' file` → PowerShell `Select-String -Path 'file' -Pattern 'pat' | Select-Object -ExpandProperty Line`.
   - **Read a file:** `cat` → `Get-Content`. **List recursively:** `find`/`ls -R` → `Get-ChildItem -Recurse`. **Discard errors:** `2>/dev/null` → `2>$null`.
   - On PowerShell, **never** use `$_` / `ForEach-Object` in a one-liner passed to the terminal — the `$_` gets stripped and the command fails to parse; use `Select-Object -ExpandProperty <Prop>` instead. **Never** mix CMD syntax (`dir /s /b`, `2>nul`, `type`).
   - Keep commands **single-line and simple**. A multi-line `python3 -c "…"` / heredoc with nested quotes **hangs the terminal** (it waits at a continuation prompt) — use `read_file` + reason instead.

6. **Every command must end by itself. A command that waits for a human is a wedged run.**
   You are not at the keyboard. Nothing you type can answer a prompt, so a command that stops to ask one
   never returns: no output, no error, no end — the run simply sits there while the terminal beside it
   plainly shows the question. Seen on the bench: `JLinkExe -device NRF9161_XXAA … -CommanderScript` — the
   device name was not recognised, J-Link opened its interactive selection prompt, and the run parked for
   eight and a half minutes.
   - **Give interactive tools their non-interactive flags.** J-Link Commander: `-NoGui 1 -ExitOnError 1
     -AutoConnect 1` (and prefer `nrfutil device` / `west` for reset, erase, flash and recovery — they are
     non-interactive by design). Package managers: `-y`. `git`: `GIT_TERMINAL_PROMPT=0`. `ssh`: `-o
     BatchMode=yes`.
   - **Close the stdin door anyway:** append `< /dev/null` (POSIX). A tool that still tries to read then
     fails fast instead of waiting.
   - **Put a wall clock on anything that reads a port or waits on a network** — `timeout 30 …` — so a quiet
     radio or an unattached modem ends the command instead of the run.
   - **No heredocs, no interactive REPLs, no pagers.** Write a file with a single-line `printf`/`echo` or
     with `write_to_file`, never `cat > f <<'EOF'`. Pipe anything long through `| cat`, never `less`/`more`,
     and never launch `python3`, `gdb` or a shell without a script to run.
   - **If a command hangs, that is a defect in how you invoked it.** Do not report it as a tool being broken
     or the hardware being unresponsive; re-issue it in a form that must terminate.
