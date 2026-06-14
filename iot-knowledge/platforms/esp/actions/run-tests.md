# Action: Run Tests (Unity + pytest-embedded) (actions/run-tests.md)

## When Used
Called from `workflows/test-validate.md` — runs a project's **Unity** test cases and reports PASS/FAIL.
ESP-IDF has three places the same Unity suite can run; pick the tier the user can actually use:

| Tier | Runs on | Needs a board? | Needs install? |
|---|---|---|---|
| **A — Host (`linux` target)** | your PC (FreeRTOS POSIX sim) | **No** | Linux/macOS: no · Windows: WSL |
| **Q — QEMU** | emulated ESP chip | **No** | one-time `qemu-xtensa` / `qemu-riscv32` |
| **B — On hardware** | the real chip | **Yes** | no |

> Same Unity cases, different place. **Tier A** is the fast everyday "did I break the logic?" tier, but
> the `linux` target only builds code with **no chip drivers** (pure logic, parsers, state machines).
> **Tier Q** emulates the real chip arch (good for code that needs IDF startup) but has no real
> peripherals. **Tier B** is the only tier that proves the radio/sensor/timing path.

## Pre-conditions
- A Unity test app exists — confirm with `list_files` / `search_files` before running anything:
  - component tests: a `test/` dir with `test_*.c` using `TEST_CASE("desc", "[tag]")`, plus a
    `test_apps/` runner, **or**
  - a top-level `pytest_*.py` beside a test app.
- If none exists, do NOT fabricate a command — go to **Scaffolding** below.

## STEP 0 — Resolve the tier (OS-aware — do this FIRST)
Read the **`Operating System:`** line in SYSTEM INFORMATION and what the user has:

| Situation | Tier |
|---|---|
| No board, Linux/macOS, pure-logic suite | **A** (`linux` target) — fastest, no install |
| No board, Windows (no WSL) | **Q** (QEMU) — `linux` target needs WSL on Windows |
| Code needs IDF boot / a real chip arch, no board | **Q** (QEMU) |
| A board is plugged in | **B** — the lowest-friction "with hardware" path, no install |

Chip arch for Tier Q (from `sdkconfig` `CONFIG_IDF_TARGET`): **Xtensa** = esp32/esp32s2/esp32s3
(`qemu-xtensa`); **RISC-V** = esp32c3/c6/h2/p4 (`qemu-riscv32`).

## Tier A — Host (`linux` target), no board
The IDF "linux" target builds the app against a POSIX/FreeRTOS host simulator — no chip, no flash.
Run through `triggerEspAction` action="execute" (`rules/esp-terminal.md`):
```
idf.py --preview set-target linux        # one-time; switches the build to the host sim
idf.py build
pytest --target linux --embedded-services idf    # or: build/<proj>.elf  (run the host binary directly)
```
- Only **driver-free** code links on `linux`. A suite that pulls in `driver/`, Wi-Fi or `esp_*`
  hardware APIs will not build here — that is expected; route it to Tier Q or B, don't call it a failure.
- `set-target linux` wipes the chip `sdkconfig` — warn the user; switch back with
  `idf.py set-target <chip>` afterwards.

## Tier Q — QEMU, no board
Emulates the actual chip so IDF startup + most no-peripheral code runs. Install once, then run:
```
python -m idf_tools.py install qemu-xtensa     # or qemu-riscv32 for C3/C6/H2/P4
idf.py build
pytest --target <chip> -m qemu --embedded-services idf,qemu
# quick interactive run (no pytest): idf.py qemu monitor
```
- pytest-embedded's `idf,qemu` services boot the built app in QEMU and parse the Unity output.
- QEMU has the chip core but **no real radio/sensor/GPIO** — same limit as a simulator. Don't call a
  Wi-Fi/sensor path "validated" from a QEMU run.

## Tier B — On hardware (the real chip)
Runs the **same** Unity suite on the connected board via pytest-embedded, which flashes the test app,
drives the Unity menu, and harvests PASS/FAIL over serial:
```
idf.py set-target <chip> build
pytest --target <chip> --embedded-services esp,idf -p <port>
```
- Resolve `<chip>` and `<port>` from `rules/device-identity.md` (always pass the port — avoids the
  30-port scan, and is required with two boards connected).
- This is the only tier that exercises the real radio/sensor/timing. Report the same PASS/FAIL summary.

## Reading the result
pytest prints a standard summary line (`N passed`, `M failed` + the failing case name). Unity's own
`Tests N Failures M Ignored` line appears in the serial/host output. For a failure, read the failing
`TEST_ASSERT_*` line in the test source — never guess which assertion fired.

| Marker | Meaning |
|---|---|
| `passed` / `Tests N Failures 0` | suite ran clean |
| `failed` / `TEST_ASSERT_* FAILED` | a real assertion failed — read the inline detail + the test `.c` line |
| build error before run | a setup/build failure, not a test failure — route to `actions/build.md` (Tier A: likely a driver dep that can't link on `linux` → use Tier Q/B) |

## Scaffolding — when no test suite exists
Offer to create a minimal Unity test. Ground every assertion from a real IDF test app via
`actions/find-sample.md` (e.g. `components/*/test_apps/`) — never invent claims about *this* project's
behavior. Minimum viable layout for a component test:
```
components/<name>/
├── <name>.c / .h
├── CMakeLists.txt          # idf_component_register(... )
└── test/
    ├── CMakeLists.txt      # idf_component_register(SRCS "test_<name>.c" REQUIRES unity <name>)
    └── test_<name>.c       # TEST_CASE("does X", "[<name>]") { TEST_ASSERT_EQUAL(...); }
```
plus a small `test_apps/` runner (`app_main` calls `unity_run_menu()`), and a `pytest_<name>.py`
that runs it. Scaffold only the **framework** + one trivial `TEST_ASSERT_TRUE(true)` smoke case;
writing real assertions needs reading the project's modules first — propose that as the follow-up.

## Rules
- **Resolve the tier (Step 0) before any command.** The `linux` target is Linux/macOS (or WSL); don't
  default to it on Windows.
- Never claim a test "passed" without a pytest/Unity summary line backing it — a clean build is not a pass.
- A host/QEMU pass proves **logic**, not hardware. Never call a radio/sensor/timing path "validated"
  from Tier A/Q — route those to Tier B (on hardware).
- Keep results compact: case name + status + (on failure) the one assertion line that fired.
