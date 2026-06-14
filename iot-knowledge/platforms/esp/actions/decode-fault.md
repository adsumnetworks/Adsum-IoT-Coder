# Action: Decode a Panic / Fatal Error (actions/decode-fault.md)

## When Used
Called from `actions/analyze-logs.md` and `workflows/debug-loop.md` / `workflows/log-analyzer.md`
whenever a captured log contains a crash backtrace. Turns a raw address dump into a `file:line`.

**First check: was the log captured with `action="monitor"`?** If so, `idf.py monitor` **already
decoded** the backtrace — look for the yellow `0x...: func at path/file.c:NN` lines under the register
dump and `Backtrace:` line, and just read the **first frame in the user's code** (skip
`vPortTaskWrapper`, `_xt_lowint*`, `main_task`, ROM frames). You only run `addr2line` yourself when the
log is a **raw paste** the user gave you, or monitor could not find the `.elf`.

## Pre-conditions (manual decode)
- A captured log with a fault signature (see Detection).
- The project's `.elf` exists — `build/<project>.elf` (read the exact name from
  `build/project_description.json` `app_elf`; `list_files build/` to confirm, never assume).
- It must be the **exact build that was flashed** — a stale `.elf` gives a wrong-but-confident answer.

## Detection — fault signatures to scan for
| Signature | Meaning |
|---|---|
| `Guru Meditation Error: Core N panic'ed (<reason>)` | the panic banner — `<reason>` gives the class |
| `LoadProhibited` / `StoreProhibited` | null / invalid pointer dereference |
| `InstrFetchProhibited` | jumped to a bad address (corrupted function pointer / overflow) |
| `LoadStoreAlignment` | misaligned access |
| `IllegalInstruction` | corrupted PC / bad function pointer |
| `Load access fault` / `Store access fault` (RISC-V wording) | same pointer classes on C3/C6/H2 |
| `abort() was called at PC 0x...` | an `assert()` / `ESP_ERROR_CHECK` failed — the next line names it |
| `Backtrace: 0x...:0x... 0x...:0x...` | **Xtensa** addresses to decode (`PC:SP` pairs) |
| `MEPC : 0x...  RA : 0x...` | **RISC-V** — no backtrace line by default; decode MEPC + RA |

`Stack overflow` / Task-WDT / brownout are **not** address faults — they are handled in
`analyze-logs.md` (§3/§2/§5); don't run `addr2line` for them.

## How to decode — `addr2line` (pick the prefix by chip arch)
The toolchain is on `PATH` in the IDF env (run via `triggerEspAction` action="execute"):

| Chip | Arch | addr2line binary |
|---|---|---|
| esp32, esp32-S2, esp32-S3 | Xtensa | `xtensa-esp32-elf-addr2line` / `xtensa-esp32s2-elf-addr2line` / `xtensa-esp32s3-elf-addr2line` |
| esp32-C3, C6, H2, C2, P4 | RISC-V | `riscv32-esp-elf-addr2line` |

```bash
# Xtensa — pass the PC:SP pairs from the Backtrace line verbatim
xtensa-esp32s3-elf-addr2line -pfiaC -e build/<project>.elf 0x42016d2c:0x3fc98d00 0x420088a9:0x3fc98d20

# RISC-V — no Backtrace line by default; decode MEPC (crash PC) and RA (caller)
riscv32-esp-elf-addr2line -pfiaC -e build/<project>.elf 0x42007988 0x42007a4e
```
- `-e` selects the executable (the exact flashed build). `-p` plain, `-f` function, `-i` inlined
  frames, `-a` show address, `-C` demangle.
- Copy addresses **verbatim** from the log — never round or guess one.
- Read the resolved `file:line` (`read_file`) and show the offending code beside the explanation —
  a bare `main.c:18` means nothing without the line itself.

## Core dumps (the deeper option)
If the project has `CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH=y`, a full multi-task backtrace was saved to
flash on the crash — richer than the console dump. Pull and summarize it:
```bash
idf.py coredump-info          # parsed summary (crashed task, regs, backtrace) from the device
idf.py coredump-debug         # opens GDB against the dump  (interactive — get user's OK first)
```
(Equivalent: `esp-coredump info_corefile -c <core.elf|core.bin> <build/project.elf>`.) Mention the
GDB path only when `addr2line` isn't enough, and never start the interactive `coredump-debug` session
without the user's explicit go-ahead.

## Correlate, don't just translate
Cross-reference the decoded frame with the source and `sdkconfig` (per `analyze-logs.md`): a
`LoadProhibited` at a `->field` access on a pointer that was never assigned is a null-deref; an
`abort()` from `ESP_ERROR_CHECK` means an `esp_err_t` came back non-`ESP_OK` — name which call.

## Rules
- Never report a `file:line` you didn't get from `addr2line` (or monitor's decode) — no guessing from
  a function name alone.
- Always state which `.elf` you decoded against; if the project was rebuilt since the log, the
  addresses may not match — flag that risk.
- Keep it plain: *what* crashed, *where* (file:line + snippet), *why* (correlated config/code), *what
  to change*.
