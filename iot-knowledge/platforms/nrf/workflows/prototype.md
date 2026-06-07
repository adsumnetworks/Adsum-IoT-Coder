# Prototype Workflow (workflows/prototype.md)

**Triggered by:** Task text contains `scaffold a new nRF prototype` or `Start a new nRF/Zephyr prototype`

Take the user from zero to a buildable nRF/Zephyr app. This workflow's specialty is **composing one
app from one or more verified Nordic samples** — each Nordic sample shows a single feature, so a real
prototype is usually a *base* sample plus features ported from others. No project folder is required
at entry.

---

## Step 0: Scope gate (prototype exception)
Exempt from the "project must exist" check — proceed without `CMakeLists.txt`/`prj.conf`/`src/`.

---

## Step 1: Decompose the request into capabilities
Ask what they're building if unclear:
> "What are you building? e.g. 'BLE peripheral that streams BME280 sensor data and stores settings'."

Break the answer into discrete capabilities (e.g. *BLE peripheral* + *BME280 sensor* + *NVS storage*)
and tell the user the capability list you parsed.

---

## Step 2: Find a sample for each capability
**MANDATORY SKILL LOAD:** `read_file` → `platforms/nrf/actions/find-sample.md` and follow it to map
**each** capability to a verified sample (or a `samples/common` module). Do not invent paths.

---

## Step 3: Choose the base and plan the compose
- **One capability / one sample covers it** → that sample is the base; no merge needed.
- **Multiple capabilities** → base = the most infrastructure-heavy sample (usually the connectivity
  one, e.g. `peripheral_uart`/`peripheral_lbs`); the rest become **ports**. If no sample dominates,
  use a **blank app** as the base and port every capability in.

Confirm the plan with a quick **Mermaid component diagram** (base + the modules to add) so the user
verifies the architecture *before* any files are written:
> *"Here's the planned architecture — base = `<sample>`, then I add `<cap2>`, `<cap3>`. Scaffold it?"*

---

## Step 4: Scaffold the base (nRF Connect extension)
Use the **nRF Connect for VS Code** create-new-application flow — it wires the manifest + NCS version.
- **Sample base:** command **"nRF Connect: New Application from Sample"** (`nrf-connect.app.createFromSample`)
  — tell the user the exact sample to select + a destination folder/name.
- **Blank base:** command **"nRF Connect: Create a blank app"**, or create the 4-file freestanding app:
  `CMakeLists.txt` with `target_sources(app PRIVATE src/main.c)`, an empty `prj.conf`, and a minimal
  `src/main.c`.

After creation, confirm the folder with `list_files`. Do **not** add license headers (user's job).

---

## Step 5: Port the remaining capabilities (compose)
For **each** remaining capability from Step 3, one at a time:
- **MANDATORY SKILL LOAD:** `read_file` → `platforms/nrf/workflows/add-feature.md` and follow it to
  port that capability's sample into the base (C module + `prj.conf` Kconfig + overlay).

Build between ports if the user wants early validation.

---

## Step 6: Build, flash & iterate
Hand off to the Debug Loop to prove the scaffold compiles and runs:
> "Scaffold ready. Want me to build and flash it to confirm it runs on your board?"

- **MANDATORY SKILL LOAD:** if the user agrees, `read_file` → `platforms/nrf/workflows/debug-loop.md`
  and follow it (build → flash → capture).
- Then invite the next loop: *"Want to add another feature on top of this?"* → `add-feature.md`.
