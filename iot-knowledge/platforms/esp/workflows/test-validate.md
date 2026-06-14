---
id: adsum/esp/workflows/test-validate
title: "Test & Validate Workflow"
type: workflow
version: 1.0.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: esp
triggers: ["test and validate", "Prove", "works"]
requires:
  - adsum/esp/actions/run-tests
  - adsum/nrf/actions/setup-ci
  - adsum/nrf/workflows/debug-loop
---

# Test & Validate Workflow (workflows/test-validate.md)

**Triggered by:** Task text contains `test and validate` or `Prove` + `works`

Proves an ESP-IDF project behaves correctly. Offer the right path for what the dev actually has — a
board or not — and their OS. Frame this as the everyday "did I just break it?" loop, not a
pre-release/fleet gate. Scope Gate applies.

| Tier | Proves | Needs a board? | Needs install? |
|---|---|---|---|
| **A — Host (`linux` target)** | pure-logic Unity suites pass; fastest, CI-friendly | **No** | Linux/macOS: no · Windows: WSL |
| **Q — QEMU** | the same suites pass on the emulated chip (IDF boot + no-peripheral code) | **No** | one-time `qemu-xtensa`/`qemu-riscv32` |
| **B — On-hardware Unity** | the **same** Unity suites pass on the real chip | **Yes** | no |
| **C — Behavioral validation** | the firmware actually *works* — Wi-Fi, sensor, real timing | **Yes** | no |

> A, Q and B run the **same** Unity cases in different places. The `linux` target builds only
> driver-free code (logic), so a suite that touches Wi-Fi/drivers belongs on Q or B. If a board is
> plugged in, B is the lowest-friction "with hardware" path — don't push a QEMU install at someone
> holding a board.

---

## Step 1: Confirm scope gate
Run the standard Scope Gate check. If no valid project is found, follow `AGENT.md`.

---

## Step 2: Survey what's actually runnable (BEFORE offering anything)
Three facts decide which tiers apply — gather them first, don't assume:
1. **Is there a Unity suite?** `search_files` for `TEST_CASE(` and a `test/` dir or a `pytest_*.py` /
   `test_apps/`. Tiers A/Q/B need one; C does not.
2. **Is a board connected?** `python -m serial.tools.list_ports` (+ `esptool.py flash_id` for the chip).
   Tiers B and C need one.
3. **Host OS.** Read the `Operating System:` line in SYSTEM INFORMATION — it decides whether Tier A's
   `linux` target is available (Linux/macOS, or WSL on Windows) or you should steer to Q.

---

## Step 3: Offer only the tier(s) that apply (proactive buttons — Rule 5)
- **Suite + board connected** → recommend **B** (on-hardware Unity, no install) and offer **C**. Mention
  A/Q are available for board-free/CI runs.
- **Suite + no board, Linux/macOS** → **A** (`linux` host), fast and install-free; offer **Q** if the
  code needs the real chip arch.
- **Suite + no board, Windows (no WSL)** → **Q** (QEMU); A's `linux` target needs WSL.
- **No suite + board** → **C** (behavioral), and offer to **scaffold a suite** (`run-tests.md`) for A/B
  later.
- **No suite + no board** → offer to scaffold a suite; explain nothing can run until there's a suite or
  a board.

> Example: *"You've got a board connected and a `test/` suite. I can run it **on the board** (no
> install), check it **actually works** on hardware, or both. Want a board-free host run too?"*

---

## Step 4: Tiers A / Q / B — run the Unity suite
**MANDATORY SKILL LOAD:** `read_file` → `platforms/esp/actions/run-tests.md`. It owns tier resolution
(`linux` host vs QEMU vs on-hardware), the one-time QEMU install, and the PASS/FAIL summary. Run the
tier(s) Step 3 selected and report its summary.
- **Don't reflexively install QEMU.** If the user has a board and would rather run on it, route to
  Tier B — QEMU is only worth installing for genuinely board-free/CI runs.

---

## Step 5: Tier C — Behavioral validation (board, "does it really work")
Host/QEMU can't see the radio, the sensor, or real timing — this tier proves the firmware on the
actual board.
1. **MANDATORY SKILL LOAD:** `read_file` → `platforms/esp/workflows/debug-loop.md` (if not already) and
   run its Build → Flash → Capture phases.
2. Derive **expected strings** from the project itself, not assumption — read the relevant `main/`
   modules for the `ESP_LOGI` lines that mark success (e.g. `"Got IP"`, `"server started"`, a sensor
   reading format). Confirm the set with the user before treating their absence as a failure.
3. Grep the captured log (per `actions/capture-logs.md` naming) for each expected pattern; report which
   appeared, which didn't, and any fault signatures (`actions/decode-fault.md` if a panic shows up).

---

## Step 6: Summary
Report a concise pass/fail summary:
- Which tier(s) ran, on what (host / QEMU / board+port), and the case counts.
- Any failures — with the specific `TEST_ASSERT_*` line or missing pattern, not a vague "something failed".
- Suggested next step: fix-and-retest (→ `debug-loop.md`), "looks good", or make it durable (→ Step 7).

Do NOT claim the firmware is "validated" if any check failed, was skipped, or its expectations were
never confirmed. A Tier A/Q/B pass proves **logic**; only Tier C proves the radio/sensor path works.

---

## Step 7: Offer the durable setup — CI on GitHub
After a green run (any tier), offer to make it permanent — as buttons, per Rule 5:
> "Want this to run automatically on GitHub? Every PR would build the firmware and run the suite — no
> board needed."

- **MANDATORY SKILL LOAD:** if yes, `read_file` → `platforms/esp/actions/setup-ci.md` and follow it.
- Especially recommend CI when the repo is on GitHub **and** the user is on Windows/macOS — the CI
  container is Linux, so the `linux`/QEMU tiers run there with zero local setup.
- If anything in the setup is outside your reach (repo permissions, secrets, a first `git push`), apply
  core Rule 11 — say exactly what the user must do and how to verify it.
