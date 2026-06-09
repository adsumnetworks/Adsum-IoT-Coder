# Test & Validate Workflow (workflows/test-validate.md)

**Triggered by:** Task text contains `test and validate` or `Prove` + `works`

Proves a firmware project behaves correctly. A **complete** gate offers the right path for what the
dev actually has — a board or not — and their OS. There are three tiers; pick the applicable one(s),
never force a path that needs gear they don't have. Scope Gate applies. Frame this as the everyday
"did I just break it?" loop, not a pre-release/fleet gate (that's parked — see `OVERVIEW.md`).

| Tier | Proves | Needs a board? | Needs QEMU? |
|---|---|---|---|
| **A — Simulator ztest** | logic/unit suites pass; fast, CI-friendly, hardware-free | **No** | Linux: no (`native_sim`) · Win/mac: yes, one-time |
| **B — On-hardware ztest** | the **same** `ztest` suites pass on the real SoC | **Yes** | **No** |
| **C — Behavioral validation** | the firmware actually *works* — radio, sensor, real timing | **Yes** | **No** |

> **A and B run the same suites in different places.** A needs no board but (on Win/mac) needs a
> one-time QEMU install. B needs a board but **zero install**. If a board is plugged in, B is usually
> the lowest-friction "with hardware" path — don't push a QEMU install at a user who has a DK in hand.

---

## Step 1: Confirm scope gate
Run the standard Scope Gate check. If no valid project is found, follow `AGENT.md`.

---

## Step 2: Survey what's actually runnable (BEFORE offering anything)
Three facts decide which tiers apply — gather them first, don't assume:

1. **Is there a `ztest` suite?** `search_files` `file_pattern=testcase.yaml` (or legacy `sample.yaml`).
   Tiers A and B need one; C does not.
2. **Is a board connected?** Confirm via `nrf_device_tool` → `nrfutil device list` (serial + port).
   Tiers B and C need one.
3. **Host OS + env sane.** Read the `Operating System:` line in SYSTEM INFORMATION (decides Tier A's
   target and whether a QEMU install is implied). Confirm the SDK env with **`west --version`** in the
   nRF terminal — **not** `echo %ZEPHYR_BASE%` (that's cmd-only syntax and breaks in PowerShell).

---

## Step 3: Offer only the tier(s) that apply (proactive buttons — Rule 5)
Label by the real OS/board state; never offer a path the dev can't take:

- **Suite exists + board connected** → recommend **B** (on-hardware ztest, no install) and offer **C**.
  Mention A is available too *if* they want board-free/CI runs.
- **Suite exists + no board** → **A** (simulator). On Win/mac this implies the one-time QEMU setup —
  present it as a deliberate choice, not a surprise.
- **No suite + board connected** → **C** (behavioral), and offer to **scaffold a suite**
  (`run-twister.md` Scaffolding) for A/B later.
- **No suite + no board** → offer to scaffold a suite; explain nothing can run until there's a suite
  (and, on Win/mac, QEMU) or a board.

> Example: *"You've got a DK connected and a `tests/` suite. I can run the suite **on the board**
> (no install), check that it **actually works** on hardware, or both. Want a board-free simulator
> run too (needs a one-time QEMU install)?"*

---

## Step 4: Tier A — Simulator ztest (no board)
**MANDATORY SKILL LOAD:** `read_file` → `platforms/nrf/actions/run-twister.md`. It resolves the
OS-aware target (`native_sim` on Linux, QEMU `qemu_cortex_m3`/`mps2/an521` on Win/mac) and owns the
**one-time QEMU setup** guide. Report the PASS/FAIL summary it defines.
- **Don't reflexively install QEMU.** If the user has a board and would rather use Tier B, route there
  instead — QEMU is only worth installing for genuinely board-free/CI runs.

---

## Step 5: Tier B — On-hardware ztest (board, formal pass/fail, no QEMU)
**MANDATORY SKILL LOAD (if not already):** `read_file` → `platforms/nrf/actions/run-twister.md` and use
its **"Run on hardware"** section. This runs the *same* suites on the real SoC via Twister's
`--device-testing` mode — no simulator, no QEMU:

```
<ZEPHYR_BASE>/scripts/twister --device-testing --device-serial <COM/tty> \
  --device-serial-baud 115200 -p <board>/<soc> -T <path/to/tests> -i
```
- Resolve `<COM/tty>` and `<board>/<soc>` from the Step 2 `nrfutil device list` / `device-info`
  (`actions/build.md` board resolution). Confirm the board↔suite target match before flashing.
- This is the best-practice "with a board" formal test. Report the same PASS/FAIL summary as Tier A.

---

## Step 6: Tier C — Behavioral validation (board, "does it really work")
Simulators can't see the radio, the sensor, or real timing — this tier proves the firmware on the
actual board it will ship on.

1. **MANDATORY SKILL LOAD:** `read_file` → `platforms/nrf/workflows/debug-loop.md` (if not already
   loaded) and run its Build → Flash → Capture phases.
2. Derive **expected strings** from the project itself, not assumption — read the relevant `src/`
   modules for `LOG_INF`/`printk` lines that mark success states (e.g. `"Connected"`,
   `"Advertising started"`, a sensor reading format string). Confirm the set with the user before
   treating their absence as a failure:
   > "I'll check the captured log for: `<list of strings/patterns>` — does that match what 'working'
   > looks like for this project, or is there something else I should look for?"
3. Grep the captured log (per `actions/capture-logs.md` naming) for each expected pattern; report which
   appeared, which didn't, and any fault signatures (`actions/decode-fault.md` if one shows up).

---

## Step 7: Summary
Report a concise pass/fail summary:
- Which tier(s) ran, on what (simulator target / board serial), and the scenario/check counts
- Any failures — with the specific assertion or missing pattern, not a vague "something failed"
- Suggested next step: fix-and-retest (→ `debug-loop.md`) or "looks good"

Do NOT claim the firmware is "validated" if any check failed, was skipped, or its expectations were
never confirmed with the user. A Tier A/B pass proves **logic**; only Tier C proves the radio/sensor
path actually works.
