# Test & Validate Workflow (workflows/test-validate.md)

**Triggered by:** Task text contains `test and validate` or `Prove` + `works`

Proves a firmware project behaves correctly — **host-side first** (a simulator, no hardware, fast,
everyday), **on-hardware second** (build → flash → capture → assert, for the checks a simulator can't
make: real radio, real sensor, real timing). Scope Gate applies. Frame this as the dev's everyday
"did I just break it?" loop, not a pre-release/fleet gate — that's parked (see `OVERVIEW.md` north star).

> ⚠️ **The host simulator is OS-specific — do not assume `native_sim`.** `native_sim` is supported
> **only on Linux**. On **Windows and macOS** the host tier is **QEMU** (`qemu_cortex_m3`, or
> `mps2/an521` for Cortex-M33 parts). Picking the wrong one is the top cause of "tests won't run."
> `actions/run-twister.md` Step 0 owns the full OS→target table and the Windows QEMU setup guide —
> let it resolve the target; never hardcode `native_sim` from this workflow.

---

## Step 1: Confirm scope gate

Run the standard Scope Gate check. If no valid project is found, follow Scope Gate instructions
in `AGENT.md`.

---

## Step 2: Determine test tier

Use `ask_followup_question` (Rule 5 — proactive buttons). Label the host tier by the **actual host
OS** (read the `Operating System:` line in SYSTEM INFORMATION) so the button is truthful — don't say
"native_sim" on a Windows/macOS machine:

> "Which validation do you want?
> - Host logic tests (simulator) — no hardware needed, fast, run this often
> - On-hardware checks — requires a connected nRF board
> - Both (host first, then hardware)"

On Linux the simulator is `native_sim`; on Windows/macOS it's QEMU (`run-twister.md` resolves it).

---

## Step 3: Host tests (simulator / Twister)

1. Check for a `tests/` directory containing `testcase.yaml` with `list_files` /
   `search_files` (`file_pattern=testcase.yaml`).
2. If found: **MANDATORY SKILL LOAD** — `read_file` `platforms/nrf/actions/run-twister.md` before
   running anything. Execute exactly as it describes — its **Step 0 resolves the OS-aware sim target**
   (`native_sim` on Linux, QEMU on Windows/macOS); report the PASS/FAIL summary it defines.
   - **Windows pre-check:** if the host OS is Windows and the first run errors on QEMU /
     `qemu-system-arm` / `QEMU_BIN_PATH`, do NOT retry on `native_sim`. Walk the user through
     `run-twister.md`'s **one-time QEMU setup** (install + `QEMU_BIN_PATH`) once, then re-run.
   - **Honesty:** a simulator pass proves **logic only** (parsers, state machines, algorithms). It
     cannot prove the radio, an I²C/SPI sensor, or real timing — those belong to Step 4 (hardware) or
     BabbleSim (Linux). Don't call a peripheral path "validated" from a sim run.
3. If none exists, offer to scaffold:
   > "No test suite found in this project. Want me to scaffold a basic Zephyr test module?"
   - On yes: `run-twister.md`'s **Scaffolding** section has the minimal 4-file `ztest` layout —
     framework only (suite registration + one smoke `zassert_true`). Real assertions about *this*
     project's behavior come after, once its modules are read — never invent them up front.

If failures appear, offer to hand off to `debug-loop.md` to investigate and fix.

---

## Step 4: On-hardware checks

Simulators can't see the radio, the sensor, or real timing — this tier proves the firmware on the
actual board it will ship on.

1. **MANDATORY SKILL LOAD** — `read_file` `platforms/nrf/workflows/debug-loop.md` (if not already
   loaded this task) and run its Build → Flash → Capture phases.
2. Derive **expected strings** from the project itself, not from assumption — read the relevant
   `src/` modules for `LOG_INF`/`printk` lines that mark success states (e.g. `"Connected"`,
   `"Advertising started"`, a sensor reading format string). Confirm the expected set with the user
   before treating their absence as a failure:
   > "I'll check the captured log for: `<list of strings/patterns>` — does that match what 'working'
   > looks like for this project, or is there something else I should look for?"
3. Grep the captured log (per `actions/capture-logs.md` naming) for each expected pattern; report
   which appeared, which didn't, and any fault signatures (`actions/decode-fault.md` if one shows up).

---

## Step 5: Summary

Report a concise pass/fail summary:
- Which tier(s) ran, and the scenario/check counts
- Any failures — with the specific assertion or missing pattern, not a vague "something failed"
- Suggested next step: fix-and-retest (→ `debug-loop.md`) or "looks good"

Do NOT claim the firmware is "validated" if any check failed, was skipped, or its expectations were
never confirmed with the user.
