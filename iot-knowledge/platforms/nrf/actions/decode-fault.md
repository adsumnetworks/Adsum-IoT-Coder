# Action: Decode a Fatal Error / Fault (actions/decode-fault.md)

## When Used
Called from `actions/analyze-logs.md` §3 (Fault Trace Decoding) and `workflows/log-analyzer.md` /
`workflows/debug-loop.md` whenever a captured log contains a fault signature. Turns a meaningless
register dump into a `file:line` the user can act on.

## Pre-conditions
- A captured log containing a fault signature (see Detection below).
- The project's `.elf` exists — resolve its sysbuild-aware path per `actions/build.md` §Output
  (`<build_dir>/<app-folder-name>/zephyr/zephyr.elf`; `list_files` to confirm, never assume).

## Detection — fault signatures to scan for
| Signature | Meaning |
|---|---|
| `>>> ZEPHYR FATAL ERROR <N>: <reason>` | Top-line fatal error banner — always present, gives the reason string |
| `***** USAGE FAULT *****` / `BUS FAULT` / `MPU FAULT` / `HARD FAULT` | ARM Cortex-M fault class |
| `Stack overflow (context area not valid)` | Stack too small — usually means "stop, don't decode": bump `CONFIG_MAIN_STACK_SIZE` / the offending thread's stack |
| `Faulting instruction address (r15/pc): 0x........` | The address to decode — **this is the one you need** |
| `r14/lr: 0x........` | Caller of the faulting function — decode this too when PC alone isn't enough |
| `FATAL ERROR: SecureFault` + `PC:`/`LR:` | TF-M secure fault (different frame format, same decode method) |

If none of these appear, there is no fault to decode — say so plainly; do not invent one.

## How to decode — `addr2line`

1. **Extract the address(es).** Pull `pc` (and `lr` if `pc` resolves to a library/assembly stub with
   no useful line) verbatim from the log. Never guess or round an address.
2. **Resolve the `.elf` path** via `actions/build.md`'s sysbuild rule + `list_files` — do not assume
   `build/zephyr/zephyr.elf`.
3. **Run `addr2line`** through `nrf_device_tool` (`action="execute"` — see `rules/nrf-terminal.md`;
   the nRF Connect Terminal's pre-loaded toolchain env puts `arm-zephyr-eabi-addr2line` on `PATH`):
   ```bash
   arm-zephyr-eabi-addr2line -e <build_dir>/<app-folder-name>/zephyr/zephyr.elf -f -p 0x<pc> 0x<lr>
   ```
   - `-e` selects the executable (must match the **exact build** that was flashed — a stale `.elf`
     gives a wrong-but-confident answer; if in doubt, ask whether the log is from the current build).
   - `-f` prints the function name, `-p` makes the output human-readable (`file.c:NNN`).
   - If `arm-zephyr-eabi-addr2line` isn't on `PATH`, resolve the toolchain root with
     `nrfutil toolchain-manager list` and call the binary at
     `<toolchain>/opt/zephyr-sdk/arm-zephyr-eabi/bin/arm-zephyr-eabi-addr2line`.
4. **Read the resolved location.** `read_file` the `file:line` addr2line returns and show the
   offending code alongside the explanation — a bare `file.c:771` means nothing to the user without
   the line itself.
5. **Correlate, don't just translate.** Cross-reference with `prj.conf` / overlays per
   `analyze-logs.md` §2 — e.g. a usage-fault PC landing in `k_thread_stack_alloc` plus a
   `Stack overflow` banner means "raise the stack size," not "here's the crashing line."

## Special cases
- **`Stack overflow`** — the PC/LR often point at unrelated code (the overflow corrupted the frame).
  Skip decoding; recommend raising the relevant `CONFIG_*_STACK_SIZE` instead.
- **Core dumps** (`CONFIG_DEBUG_COREDUMP=y`) — richer than a register dump (full backtrace via GDB),
  but requires `scripts/coredump/coredump_gdbserver.py <elf> <dump.bin>` + a GDB session. Mention it
  as the deeper option only if `addr2line` doesn't give a clear answer; do not start a GDB session
  without the user's explicit go-ahead (it's an interactive, blocking tool).

## Rules
- Never report a `file:line` you didn't get from `addr2line` — no guessing from function names alone.
- Always state which `.elf` you decoded against; if the project was rebuilt since the log was
  captured, the addresses may no longer match — flag that risk to the user.
- Keep the explanation in plain terms: *what* crashed, *where* (file:line + snippet), *why* (the
  correlated config/code reason), *what to change*.
