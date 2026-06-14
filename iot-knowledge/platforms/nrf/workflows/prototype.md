---
id: adsum/nrf/workflows/prototype
title: "Prototype Workflow"
type: workflow
version: 1.0.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
triggers: ["scaffold a new nRF prototype", "Start a new nRF/Zephyr prototype"]
requires:
  - adsum/nrf/actions/find-sample
  - adsum/nrf/workflows/add-feature
  - adsum/nrf/workflows/debug-loop
---

# Prototype Workflow (workflows/prototype.md)

**Triggered by:** Task text contains `scaffold a new nRF prototype` or `Start a new nRF/Zephyr prototype`

Take the user from zero to a buildable nRF/Zephyr app. This workflow's specialty is **composing one
app from one or more verified Nordic samples** — each Nordic sample shows a single feature, so a real
prototype is usually a *base* sample plus features ported from others. No project folder is required
at entry.

**You do the work.** The user came here to have the prototype built, not to be handed a list of
samples to open themselves. Scaffold the files yourself (copy from the verified sample); only fall
back to "you create it" if the user explicitly asks to. Never end a step with "now go select sample X
in the wizard" as the *only* path forward.

---

## Step 0: Scope gate (prototype exception)
Exempt from the "project must exist" check — proceed without `CMakeLists.txt`/`prj.conf`/`src/`.

---

## Step 1: Decompose the request — capabilities **and** device topology
Ask what they're building if unclear:
> "What are you building? e.g. 'BLE peripheral that streams BME280 sensor data' or 'a central that
> collects from a sensor node'."

Parse **two** things and tell the user both:
1. **Capabilities** — discrete features (e.g. *BLE peripheral* + *BME280 sensor* + *NVS storage*).
2. **Device topology** — how many devices/roles. Watch for **two-role** requests:
   - "central ↔ peripheral", "collector + sensor node", "gateway + tag", "one talks to another"
     → **two apps, two boards** (see the two-device track below). This is the case that goes wrong
     when treated as a single app — call it out explicitly and plan it as two.
   - Otherwise → single device.

---

## Step 2: Find a sample for each capability
**MANDATORY SKILL LOAD:** `read_file` → `platforms/nrf/actions/find-sample.md` and follow it to map
**each** capability to a verified sample (or a `samples/common` module). Do not invent paths.
- **Two-device topology:** find-sample returns a **matched pair** (e.g. `central_uart` ↔
  `peripheral_uart`) — one sample per role. You will scaffold **both**.
- **I²C / external sensor capability:** the sample is only the read loop — the board wiring lives in
  the **I²C sensor recipe in `add-feature.md`**. Note that now; you'll apply it in Step 5.

---

## Step 3: Plan the architecture — and confirm with a diagram BEFORE writing
Pick the base and the ports, then **draw it and get a yes before any file is written** (core.md
rule 6). Match the diagram to the topology:

- **Single device** → a **component map** (Mermaid `flowchart`): base sample + the modules you'll add.
  ```mermaid
  flowchart LR
    base["peripheral_uart (base)"] --> sensor["BME280 module"]
    base --> nvs["NVS settings"]
  ```
- **Two devices** → a **connection timeline** (Mermaid `sequenceDiagram`) so the user sees the
  interaction you're about to build — and so you have the picture to reason about later if the link
  breaks:
  ```mermaid
  sequenceDiagram
    participant C as Central (central_uart)
    participant P as Peripheral (peripheral_uart)
    P->>C: advertise (NUS UUID)
    C->>P: connect
    C->>P: GATT discover + subscribe (NUS RX)
    P-->>C: notify (sensor data)
  ```
  State plainly: **"This is two apps on two boards."** Then:
> *"Here's the planned architecture — base = `<sample>`, then I add `<cap2>`, `<cap3>`. Scaffold it?"*

**Composition rule (single device):** one capability/one sample → that sample is the base. Multiple →
base = the most infrastructure-heavy sample (usually the connectivity one, e.g.
`peripheral_uart`/`peripheral_lbs`); the rest become **ports**. If none dominates, base = a blank app.

---

## Step 4: Scaffold the base — **you create it** (don't send the user to the wizard)
First ask **where** to create it (destination folder + app name) — that's the only thing you need from
the user. Then build it yourself:

- **Default — agent-driven file copy (robust, no clicking):** copy the chosen verified sample into the
  destination with `read_file` + `write_to_file` (`CMakeLists.txt`, `prj.conf`, `src/`, any
  `boards/*.overlay`, `sample.yaml`→drop or keep as reference). This works headlessly and is the path
  to prefer — it's what "do it for me" means.
- **Blank base:** create the 4-file freestanding app — `CMakeLists.txt` with
  `target_sources(app PRIVATE src/main.c)`, a minimal `prj.conf`, and a minimal `src/main.c`.
- **Alternative (only if the user prefers to do it):** the **nRF Connect for VS Code** "New Application
  from Sample" command (`nrf-connect.app.createFromSample`) — offer this as a choice, with the exact
  sample to pick, not as the default.

Offer the choice as buttons, not prose:
> Options: `["Scaffold it for me", "I'll create it from the sample myself"]`

**Two-device:** scaffold **both** apps the same way — e.g. `myproj/central/` and `myproj/peripheral/`
(or two destinations). Each is a full app with its own build dir. Confirm both folders with `list_files`.
Do **not** add license headers (user's job).

---

## Step 5: Port the remaining capabilities (compose)
For **each** remaining capability from Step 3, one at a time:
- **MANDATORY SKILL LOAD:** `read_file` → `platforms/nrf/workflows/add-feature.md` and follow it to
  port that capability's sample into the base (C module + `prj.conf` Kconfig + overlay).
- **I²C / external sensor:** use add-feature's **I²C sensor recipe** specifically — the overlay, the
  right `&i2cN` controller, the **7-bit address**, and the nRF52 **`nordic,nrf-twim`** gotcha. An
  overlay change requires a **pristine** build.

Build between ports if the user wants early validation.

---

## Step 6: Build, flash & iterate — through the Debug Loop ONLY, never freehand
Hand off to the Debug Loop to prove the scaffold compiles and runs:
> "Scaffold ready. Want me to build and flash it to confirm it runs on your board?"

- **MANDATORY SKILL LOAD:** if the user agrees, `read_file` → `platforms/nrf/workflows/debug-loop.md`
  and run the **whole** loop — Build → Flash → **Capture → Analyze** — loading each phase's Action per
  the Command Gate. Never issue `west build`/`west flash`/a capture from memory because "the prototype
  is simple" — that try-and-error path is the documented failure mode. A capture you never analyze
  proves nothing; an overlay/Kconfig change needs a **pristine** build (`actions/build.md`).
- **Two-device build & flash:** build each app into its **own build dir** (`west build -d`), and flash
  each to its **own board by serial number** — resolve serials with `nrfutil device list`, then flash by
  `--dev-id <serial>` (per `actions/flash.md`; `--snr` is deprecated). Confirm the central/peripheral
  board assignment with the user before flashing — never assume which serial is which role.
- **When a two-device link misbehaves, draw the timeline first.** Before guessing, render the
  `sequenceDiagram` and mark **where it broke** (advertising? connect? service discovery? subscribe?
  notify?) using each board's captured log — then hand the specific failed step to `debug-loop.md`.
  A 2-device root cause is far clearer as an annotated timeline than as prose.
- Then invite the next loop: *"Want to add another feature on top of this?"* → `add-feature.md`.
