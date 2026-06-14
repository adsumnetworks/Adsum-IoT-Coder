---
id: adsum/nrf/actions/analyze-logs
title: "Action: Analyze Device Logs"
type: action
version: 1.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: nrf
requires:
  - adsum/nrf/actions/capture-logs
  - adsum/nrf/actions/decode-fault
---

# Action: Analyze Device Logs (actions/analyze-logs.md)

## When Used
Called from: Debug Loop Phase 4, Log Analyzer Step 5, or post-capture verification.

## Pre-conditions
- Log file exists (captured via `actions/capture-logs.md` or provided by user)
- Source code and `prj.conf` for the project are accessible for correlation

## MANDATORY: Resolve the log file path before reading

**Never guess a log filename.** Captured filenames embed timestamps (e.g. `device_683451822_20260521_153438.log`) that depend on the device clock and capture moment. If you `read_file` a path the capture step did not just return, the read will fail with `File not found` and you will burn retries.

**Required order before any `read_file` on a `logs/**/*.log` path:**

1. Use `list_files` on the enclosing log directory (e.g. `logs/rtt/`, `logs/uart/`).
2. Pick the **most recently created** file matching the expected device/transport pattern.
3. Use that exact absolute path in `read_file`.

If the directory is empty or does not exist, the capture step did not produce a log — invoke `actions/capture-logs.md` first; do NOT loop on `read_file` retries.

## Analysis Approach

### 1. Structural Scan — What to Look For

**Critical Errors (stop and report immediately):**
- `<err>` level log lines
- `Zephyr Fatal Error` / `FATAL EXCEPTION` / `kernel panic` — full system crash
- `ASSERTION FAIL` — firmware assertion, often in controller or kernel code
- `MPU FAULT` / `BUS FAULT` / `USAGE FAULT` / `HARD FAULT` — ARM fault types
- Watchdog (`wdt`) timeout and reset events

**Warnings (flag if recurring):**
- `<wrn>` level log lines
- `CONFIG_*` mismatch warnings during boot
- Memory allocation failures (`k_malloc failed`, `heap exhausted`)

**BLE-Specific Patterns:**
- `disconnect reason 0x__` — decode using `protocols/BLE.md` HCI disconnect table
- `conn_complete status` (non-zero = HCI error)
- `att_err_rsp` — ATT protocol error
- `smp err` — Pairing failure
- `adv_timeout` — Advertising stopped without connection
- `ccc_changed` missing — client never subscribed to notifications
- `num_complete_packets` stuck at 0 — controller buffer exhaustion

**Boot Sequence:**
- Verify key init messages appear in order: kernel init → driver init → BLE init → advertising/scanning start
- Missing init events indicate a crash during startup

**Data Flow:**
- Count notifications/indications per second to assess throughput
- Check for gaps in sequential counters (dropped packets)

### 2. Code Correlation — Go Beyond the Log

For every significant error found in logs:
1. **Find the source:** Search the project source code for the function/callback that produced the log line.
2. **Check the config:** Cross-reference with `prj.conf` and DeviceTree overlays. Many runtime errors originate from incorrect configuration.
3. **Check stack sizes:** If a fault occurs in a thread context, verify `CONFIG_MAIN_STACK_SIZE`, `CONFIG_SYSTEM_WORKQUEUE_STACK_SIZE`, and thread-specific stacks.
4. **Check buffer sizes:** BLE buffer overflows are common — verify `CONFIG_BT_BUF_ACL_TX_SIZE`, `CONFIG_BT_L2CAP_TX_MTU`.

### 3. Fault Trace Decoding (Zephyr)

When a fault signature appears (`>>> ZEPHYR FATAL ERROR`, `***** USAGE/BUS/MPU/HARD FAULT *****`,
`Stack overflow`, `FATAL ERROR: SecureFault` — the full list lives in `actions/decode-fault.md`):

**MANDATORY SKILL LOAD:** `read_file` `platforms/nrf/actions/decode-fault.md` BEFORE attempting to
resolve the address. It defines the exact `addr2line` invocation (toolchain path, `.elf` resolution
via the sysbuild-aware rule in `build.md`), the special-case handling (stack overflow ≠ "decode it",
core dumps), and the rules for reporting a `file:line` honestly. Do not eyeball a register dump and
guess the function — a wrong-but-confident answer here is worse than "I need to decode this first."

### 4. Sparse Log Detection

If the log file contains:
- Fewer than 10 meaningful log lines
- No `LOG_MODULE_REGISTER` output
- Only boot messages with no application-level logs

Then logs are **too sparse for meaningful analysis**. Recommend switching to the Log Generator workflow to add instrumentation.

## Output

**CRITICAL CHAT RULE:** You MUST output this HIGH-QUALITY, highly structured summary directly into the chat visible to the user. This is NOT a thought process; this is your professional report to the engineer. The summary MUST use the provided template below. Do NOT hide it inside `<thinking>` tags.

### Always Provide:
1. A summary of findings using the exact template below, containing the most important log snippets inline.
2. The absolute path to the full log file (clickable link).
3. Root cause assessment (if determinable) or hypothesis (if not enough data).

### Report Template
```markdown
## Log Analysis — [Project Name / Context]

**System Overview:**
- **[Role] Device** ([SN/Port]): [Function] — [State]

**Key Findings:**

### 1. Boot & Initialization ✅/❌
- [SDK version, init events, key subsystem startup]

### 2. Connection Flow ✅/❌ (if BLE)
- [Advertising/scanning, connection, params, PHY]

### 3. Data Transfer ✅/❌
- **Stats:** [count] notifications, [interval] ms
- **Reliability:** [errors or clean]

### 4. Errors Found ❌
- [Error description, log snippet, source code reference]

**Root Cause:**
[Professional 2-3 sentence assessment]

**Log file:** [absolute path]
```
