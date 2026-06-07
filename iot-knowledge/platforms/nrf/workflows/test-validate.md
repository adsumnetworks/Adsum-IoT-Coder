# Test & Validate Workflow (workflows/test-validate.md)

> **SCAFFOLD — co-founder to author.** Placeholders below mark every decision that requires
> curated test recipes and real hardware verification. Do NOT invent test assertions.

**Triggered by:** Task text contains `test and validate` or `Prove` + `works`

This workflow verifies that a firmware project behaves correctly — first with host-side
`native_sim` tests (no hardware required), then optionally with on-hardware checks when boards
are connected. Scope Gate applies.

---

## Step 1: Confirm scope gate

Run the standard Scope Gate check. If no valid project is found, follow Scope Gate instructions
in `AGENT.md`.

---

## Step 2: Determine test tier

Ask the user which test tier to run (or run both in sequence):

> "Which validation do you want?
> - Host tests (native_sim) — no hardware needed, fast
> - On-hardware checks — requires connected nRF board
> - Both (host first, then hardware)"

---

## Step 3: Host tests (native_sim)

<!-- TODO (co-founder): define how to detect and run existing Zephyr tests in the project -->
<!-- Minimum: check for tests/ directory, west test or west build -b native_sim, parse pass/fail -->

Steps (placeholder):
1. Check for `tests/` directory with `list_files`.
2. If tests exist, build and run with `native_sim` target via `debug-loop.md` build action.
3. Parse output for `PASS` / `FAIL` markers.
4. Report results clearly. If failures: offer to load `debug-loop.md` to investigate.

If no test suite exists:
> "No test suite found in this project. Want me to scaffold a basic Zephyr test module?"
<!-- TODO (co-founder): scaffold a minimal Zephyr test module recipe -->

---

## Step 4: On-hardware checks

<!-- TODO (co-founder): define what "on-hardware check" means per project type -->
<!-- Minimum: build → flash → capture boot log → verify expected output strings present -->

Steps (placeholder):
1. Load `platforms/nrf/workflows/debug-loop.md` and run Build → Flash → Capture.
2. Check captured log for expected boot/runtime strings.
   <!-- TODO: define expected strings per project type -->
3. Report pass/fail clearly.

---

## Step 5: Summary

Report a concise pass/fail summary:
- Which tier ran
- Number of tests / checks
- Any failures and suggested next steps

Do NOT claim the firmware is "validated" if any check failed or was skipped.
