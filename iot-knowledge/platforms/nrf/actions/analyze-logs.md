# Action: Analyze Device Logs (actions/analyze-logs.md)

## When Used
Called from: Debug Loop Phase 4, Log Analyzer Step 5, or post-capture verification.

## Pre-conditions
- Log file exists (captured via `actions/capture-logs.md` or provided by user)
- Source code and `prj.conf` for the project are accessible for correlation

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

When a Zephyr Fatal Error is logged:
```
FATAL EXCEPTION: <fault_type>
Current thread: <thread_name> (0x<addr>)
r0/a1: 0x<val>  r1/a2: 0x<val>  ...
pc: 0x<val>  lr: 0x<val>
```
- The **PC** (program counter) value can be mapped to a function using `addr2line` on the `.elf` file.
- The **fault type** indicates the class of error (e.g., BUS FAULT = invalid memory access).

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
