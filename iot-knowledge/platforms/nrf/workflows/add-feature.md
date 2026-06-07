# Add Feature Workflow (workflows/add-feature.md)

> **SCAFFOLD — co-founder to author.** Placeholders below mark every decision that requires
> curated, tested recipes. Do NOT invent Kconfig values or API call sequences.

**Triggered by:** Task text contains `add a feature` or `Add a feature to`

This workflow adds a single well-scoped Zephyr/NCS feature to an existing project. It requires
a valid NCS project in the workspace (Scope Gate applies — `CMakeLists.txt` + `prj.conf` + `src/`).

---

## Step 1: Confirm scope gate

Run the standard Scope Gate check. If no valid project is found, do NOT proceed — follow the
Scope Gate instructions in `AGENT.md`.

---

## Step 2: Identify the feature

Use `ask_followup_question` if the feature is not already clear from the task:

> "Which feature would you like to add?
> - Zephyr shell (CLI over UART/RTT)
> - BLE GATT service (custom or standard)
> - NVS (non-volatile settings storage)
> - Other (describe it)"

---

## Step 3: Read the current project

Read the following files to understand the current state before modifying anything:
- `prj.conf` — active Kconfig selections
- `CMakeLists.txt` — source files and build config
- `src/main.c` (or the primary source file) — application entry point

Do NOT modify files before completing this read step.

---

## Step 4: Apply the feature recipe

<!-- TODO (co-founder): write one recipe block per feature type -->
<!-- Each recipe: exact Kconfig lines for prj.conf, source changes, devicetree overlay if needed -->

| Feature | Recipe status |
|---|---|
| Zephyr shell | TODO |
| BLE GATT custom service | TODO |
| NVS | TODO |

Apply only the changes specified in the matching recipe. Do NOT add unrelated Kconfig options
or source changes. Show a diff-style summary before writing files.

---

## Step 5: Verify

After applying changes, offer to build:
> "Changes applied. Want me to run a build to confirm it compiles?"

If yes, load `platforms/nrf/workflows/debug-loop.md` and run the build step only (no flash unless
the user asks).
