---
id: adsum/rules/tool-routing
title: "Tool Routing Directives"
type: knowledge
version: 1.0.0
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
   - General host system operations: `git`, file manipulation, grep, regex searches
   - Standard package managers: `npm`, `pip`, `apt`
   - Any operation that does not need the SDK toolchain environment

3. **Dedicated Device Tools for Specialized Hardware Operations**
   Some operations require dedicated tools that go beyond simple CLI commands (e.g., live log capture with multi-device synchronization, reset coordination, transport auto-detection).
   - Refer to `platforms/<platform>/PLATFORM.md` for which dedicated tools are available and what they do.
   - These tools handle complexity that shell commands alone cannot (e.g., simultaneous multi-device RTT capture with file naming).

4. **Never Mix Terminals**
   A command that works in `execute_command` may NOT work in a platform terminal, and vice-versa. Do not assume cross-compatibility.
