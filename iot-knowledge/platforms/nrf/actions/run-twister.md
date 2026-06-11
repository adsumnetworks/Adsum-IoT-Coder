# Action: Run Host Tests via Twister (actions/run-twister.md)

## When Used
Called from `workflows/test-validate.md` — **Tier A** (simulator ztest, no board) and **Tier B**
(on-hardware ztest via `--device-testing`). Builds and runs a project's Zephyr/`ztest` suites and
reports PASS/FAIL. Same suites either way; the only difference is *where* they run — a simulator
(`native_sim`/QEMU) or the real SoC. **If a board is connected, Tier B needs no QEMU** — prefer it
over pushing a QEMU install.

## Pre-conditions
- A `tests/` directory containing `testcase.yaml` (or legacy `sample.yaml`) exists in the project —
  confirm with `list_files` / `search_files` (`file_pattern=testcase.yaml`) before running anything.
- If none exists, do NOT fabricate a command — go to **Scaffolding** below instead.

## STEP 0 — Resolve the host-sim target (OS-aware — do this FIRST)

> ⚠️ **This is the #1 cause of "tests won't run" on Windows.** `native_sim` is **NOT** a
> cross-platform target. Do not default to it. Read the **`Operating System:`** line in SYSTEM
> INFORMATION and pick the target from this table before running anything.

| Host OS | Host-sim target to use | Why |
|---|---|---|
| **Linux** | `native_sim` (default, fastest) | POSIX-arch native port is supported **only** on Linux; bundled, no extra install. |
| **macOS** | `qemu_cortex_m3` (or `mps2/an521`) | POSIX arch (`native_sim`) is officially **unsupported on macOS**. QEMU ships with the Zephyr SDK on macOS — works out of the box. |
| **Windows** | `qemu_cortex_m3` (or `mps2/an521`) | `native_sim` needs a host POSIX toolchain (WSL2 + 32-bit `gcc-multilib`) that stock Windows PCs **do not have**. QEMU is the supported host tier — but it is **not bundled on Windows**, see one-time setup below. |

**Which QEMU target — pick by the project's SoC architecture** (read the board target from
`build_info.yml` / `actions/build.md` resolution, or `boards/<soc>.md`):

| nRF SoC | Arm core | QEMU target |
|---|---|---|
| nRF52832 / nRF52840 / nRF52833 / nRF52811 … | Cortex-M4 (Arm v7-M) | `qemu_cortex_m3` |
| nRF5340 (cpuapp/cpunet), nRF9160 / nRF91, nRF54L15 | Cortex-M33 (Arm v8-M) | `mps2/an521` |

> `qemu_cortex_m3` has no FPU and is an Arm-v7-M core, not a literal M4 — that is fine for
> **logic** tests (Zephyr falls back to soft-float). Use `mps2/an521` when the M33 features
> (MPU/TrustZone/v8-M) actually matter.

**Always pass `-p <target>`. NEVER run bare `twister -T .`** — with no `-p` Twister fans out to
**both** `native_sim` *and* `qemu_cortex_m3`, so on Windows/macOS the `native_sim` half fails noisily
and buries the real result.

### What a simulator can and cannot prove
QEMU (and `qemu_cortex_m3`/`mps2`) emulate the **generic Arm core + generic peripherals only** — there
is **no nRF RADIO, no nRF UARTE, no I²C/SPI sensor, no real timing**. So:
- ✅ Good for **pure-logic `ztest`**: parsers, state machines, ring buffers, algorithms, math, any
  `type: unit` suite — the everyday "did I just break it?" tier.
- ❌ Cannot prove anything touching nRF peripherals, the radio, an I²C sensor, or real timing. Those
  need **BabbleSim** (`nrf52_bsim` / `nrf5340bsim` — high-fidelity but **Linux-only**) or the
  **on-hardware** tiers (Tier B/C in `test-validate.md`). Say so honestly; do not claim a sensor/BLE
  path is "validated" from a QEMU run.

## Windows: one-time QEMU setup (ONLY for board-free / Tier A runs)
QEMU is **not** bundled in the nRF Connect SDK on Windows (it ships inside the Zephyr SDK on
Linux/macOS only). It is needed **solely** for the simulator tier. So:

- **If a board is connected → do NOT install QEMU.** Use **Tier B** (`--device-testing`, below) — it
  runs the same suites on the real SoC with zero install. Only offer the QEMU install when the user
  genuinely wants board-free / CI runs.
- **Detect "missing" cleanly.** Prefer letting Twister report it (a `BLOCK`/`ERROR` naming
  `qemu-system-arm` / `QEMU_BIN_PATH`). If you probe proactively, use a **shell-correct** form — the
  nRF terminal may be PowerShell or cmd, so never use the cmd-only `echo %VAR%` / `&&` / `2>nul`
  (it errors in PowerShell). PowerShell: `if (Get-Command qemu-system-arm -EA SilentlyContinue) {...}`.

When the user opts into the install:

1. **Install QEMU.** The NCS toolchain ships Chocolatey, so the simplest path is
   `choco install qemu` (run in the nRF Connect terminal). Otherwise download the Windows installer
   from `https://www.qemu.org/download/#windows` and install it.
2. **Note the install folder**, e.g. `C:\Program Files\qemu`.
3. **Add it to `PATH`**, and set `QEMU_BIN_PATH` to that same folder (Twister reads `QEMU_BIN_PATH`
   on Windows to find the emulator). `setx QEMU_BIN_PATH "C:\Program Files\qemu"` works in both
   PowerShell and cmd, but only affects **new** terminals — or add it to `%userprofile%/zephyrrc.cmd`.
4. **Verify:** `qemu-system-arm --version` prints a version (or `$env:QEMU_BIN_PATH` is set in a fresh
   terminal).
5. Re-run the test command. (On Linux/macOS QEMU is already inside the Zephyr SDK — no install needed.)

## Run the tests

Twister lives at `<ZEPHYR_BASE>/scripts/twister` (resolve `ZEPHYR_BASE` from the nRF Connect Terminal
env or `build_info.yml`). Run it through `nrf_device_tool` (`action="execute"` — `rules/nrf-terminal.md`;
the terminal pre-loads `ZEPHYR_BASE`), passing the **target resolved in Step 0**:

```bash
# Linux
<ZEPHYR_BASE>/scripts/twister -T <path/to/tests> -p native_sim -i

# macOS / Windows (Cortex-M4 project)
<ZEPHYR_BASE>/scripts/twister -T <path/to/tests> -p qemu_cortex_m3 -i

# macOS / Windows (Cortex-M33 project: nRF5340 / nRF91 / nRF54L)
<ZEPHYR_BASE>/scripts/twister -T <path/to/tests> -p mps2/an521 -i
```

> **Windows invocation:** twister is an extension-less Python script — call it as
> `python <ZEPHYR_BASE>\scripts\twister -T <path> -p qemu_cortex_m3 -i` if running it directly fails.

- `-T <path>` — the test root (the directory **containing** `testcase.yaml`, not the file).
- `-p <target>` — **mandatory**; the host-sim target from Step 0. Do not omit it.
- `-i` / `--inline-logs` — print failure detail to stdout so you don't need a second file read.
- One scenario only: add `--scenario <path/to/your.test.scenario.name>` (dotted name from
  `testcase.yaml`'s `tests:` key).
- Discover first, don't run: `--list-tests -T <path>` (use when the user asks "what tests do I have").

**Equivalent single-app shortcut** (one test app, no Twister filtering needed) — same target rule:
`west build -b <target> -t run` from the test app directory (`-b native_sim` on Linux, `-b qemu_cortex_m3`
/ `-b mps2/an521` on Windows/macOS). To stop a QEMU run: `Ctrl-a` then `x`.

## Run on hardware (Tier B — no QEMU, no native_sim)
When a board is connected, run the **same** suites on the real SoC with Twister's device-testing mode.
This is the lowest-friction "with hardware" path — no simulator, no QEMU install, works identically on
Windows/macOS/Linux:

```bash
<ZEPHYR_BASE>/scripts/twister --device-testing --device-serial <COM/tty> --device-serial-baud 115200 -p <board>/<soc> -T <path/to/tests> -i
```

> **One line, OS-aware invocation.** The command is a single line — the `\`-continuation form is
> bash-only. On Windows call twister as `python <ZEPHYR_BASE>\scripts\twister …` (extension-less Python
> script, backslashes); in PowerShell use backtick `` ` `` if you must wrap. Same rule as Tier A.

- `--device-serial` — the board's serial port: `COMx` (Windows), `/dev/ttyACMx` (Linux),
  `/dev/tty.usbmodem*` (macOS). Resolve it from `nrfutil device list`.
- `-p <board>/<soc>` — the **real** board target (e.g. `nrf52840dk/nrf52840`), **not** a sim target.
- Twister builds → flashes → runs each suite on the device → harvests PASS/FAIL over serial.
- Multiple boards connected: also pass `--device-serial` per board, or use a hardware map; confirm the
  board↔suite match with the user first (never assume which serial is which).
- Read results with the same table below. The `native_sim`/QEMU `platform_allow` filter doesn't apply —
  here the suite just needs `platform_allow` to include the real board (or no platform restriction).

## Reading the result
Twister writes `twister.json` / `twister.xml` to `twister-out/` (or `--outdir` if passed). Don't parse
the JSON unless asked for detail — the **console summary line** (`PASSED`/`FAILED`/`SKIPPED` counts +
per-suite status) is sufficient for the standard report.

| Console marker | Meaning |
|---|---|
| `PASS` | scenario built and asserted clean |
| `FAIL` | build succeeded but a `zassert_*` failed — read the inline log for the failing assertion + line |
| `BLOCK` / `ERROR` | build or environment failure — treat as a setup/build error, not a test failure. If on Windows/macOS and the error mentions QEMU / `qemu-system-arm` / `QEMU_BIN_PATH` → route to **Windows: one-time QEMU setup** above, not to a test-fix. Otherwise route to `actions/build.md` triage. |
| `SKIPPED` / `FILTERED` | scenario doesn't apply to the chosen target (check `platform_allow` in `testcase.yaml` — e.g. a suite pinned to `native_sim` will be filtered out on a `qemu_cortex_m3` run) |

On `FAIL`, correlate the failing `zassert_*` line with the test source — never guess which assertion
fired; read the inline log or the suite's `.log` under `twister-out/`.

> **`platform_allow` trap:** a `testcase.yaml` that pins `platform_allow: [native_sim]` will be
> **FILTERED to zero** on Windows/macOS. If a suite is meant to run cross-platform, it should allow the
> QEMU target too — e.g. `platform_allow: [native_sim, qemu_cortex_m3]` (or `integration_platforms`).
> When scaffolding, prefer the portable set; flag this if you see a native_sim-only suite produce
> "0 tests" on Windows.

## Scaffolding — when no test suite exists
Offer to create a minimal `ztest` module (ground every line from `embedded-code-guidance-ncs-zephyr`
or a real Zephyr integration-test sample via `actions/find-sample.md` — never invent assertions about
*this* project's behavior). The minimum viable layout is 4 files under `tests/<area>/`:

```
tests/<area>/
├── CMakeLists.txt      # find_package(Zephyr) + target_sources(app PRIVATE src/*.c)
├── testcase.yaml       # tests: <suite>.<case>: { platform_allow: [native_sim, qemu_cortex_m3], tags: ... }
├── prj.conf            # CONFIG_ZTEST=y
└── src/main.c          # ZTEST_SUITE(...) + ZTEST(suite, case) { zassert_* }
```

- Make the suite **portable**: `platform_allow: [native_sim, qemu_cortex_m3]` (add `mps2/an521` for
  M33 projects) so it runs on the user's actual OS, not just Linux.
- Scaffold only the **framework** (suite registration + one trivial `zassert_true` smoke case). Writing
  real assertions about *this project's* behavior requires reading its actual modules first — propose
  that as the immediate follow-up, don't bundle invented assertions into the scaffold.

## Rules
- **Resolve the OS-aware target (Step 0) before any command.** `native_sim` is Linux-only; defaulting to
  it on Windows/macOS is the bug this action exists to prevent.
- Never claim a test "passed" without a console `PASS`/summary line backing it — no inferring from
  "the build succeeded."
- A clean build is necessary but not sufficient — `BLOCK`/`ERROR` vs `FAIL` vs `PASS` are different
  things; report them as such, don't collapse them into "it worked" / "it didn't."
- A simulator pass proves **logic**, not hardware. Never call a radio/sensor/timing path "validated"
  from a QEMU/native_sim run — route those to BabbleSim (Linux) or the on-hardware tier.
- Keep results compact: scenario name + status + (on failure) the one assertion line that fired.
