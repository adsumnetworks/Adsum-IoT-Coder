# Add Feature Workflow (workflows/add-feature.md)


**Triggered by:** Task text contains `add a feature` or `Add a feature to`. Also loaded by
`prototype.md` (once per capability) to port a sample into a fresh scaffold.

Adds **one** well-scoped feature to an **existing** NCS project (Scope Gate applies —
`CMakeLists.txt` + `prj.conf` + `src/`).

---

## Step 1: Confirm scope gate
Run the Scope Gate check. If no valid project, do NOT proceed — follow `AGENT.md`.

---

## Step 2: Identify the feature
Use `ask_followup_question` if unclear:
> "Which feature? e.g. Zephyr shell (CLI), a BLE GATT service, NVS storage, a sensor driver, or
> 'port X from Nordic sample Y'."

---

## Step 3: Locate the source sample
**MANDATORY SKILL LOAD:** `read_file` → `platforms/nrf/actions/find-sample.md` and follow it to find
the sample (or `samples/common` module) that implements the feature. Confirm the path exists with
`list_files` before copying anything.

---

## Step 4: Read the project, then apply the port
Read first (do **not** modify yet): the project's `prj.conf`, `CMakeLists.txt`, `src/main.c`, and the
**source sample's** `src/`, `prj.conf`, and any `boards/*.overlay`.

Apply only the three layers the feature needs:
1. **C code** → `src/modules/<name>/`; wire into `main.c` — prefer a module init + its own
   `K_THREAD_DEFINE`, not piling logic into `main()`. Register with `target_sources(app PRIVATE ...)`.
2. **Kconfig** → merge the required `CONFIG_*` into `prj.conf`. (For a `samples/common` module, just
   enable its `CONFIG_NCS_SAMPLE_*` symbol.)
3. **Devicetree overlay** → merge nodes into `boards/<board_target>.overlay`. Validate every DT
   device with `device_is_ready()` before first use.

Show a diff-style summary before writing. Do NOT add unrelated Kconfig.

<!-- TODO (next iteration): curated recipes for Zephyr shell / BLE GATT service / NVS, grounded in
     resource://nordicsemi/embedded-code-guidance-ncs-zephyr -->

---

## Step 5: Build, flash & offer the next feature
Hand off to the Debug Loop (build → flash → capture proves the feature actually runs):
> "Feature applied. Want me to build and flash it to confirm it runs?"

- **MANDATORY SKILL LOAD:** if yes, `read_file` → `platforms/nrf/workflows/debug-loop.md` and follow
  it. A config/DT change requires a **pristine** build (see `actions/build.md`).
- Once it runs, invite the next iteration: *"Want to add another feature on top?"* (loop here).
