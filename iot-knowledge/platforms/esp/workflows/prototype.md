---
id: adsum/esp/workflows/prototype
title: "Prototype Workflow"
type: workflow
version: 1.0.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: esp
triggers: ["scaffold a new ESP-IDF prototype", "Start a new ESP-IDF prototype"]
requires:
  - adsum/nrf/actions/find-sample
  - adsum/nrf/workflows/add-feature
  - adsum/nrf/workflows/debug-loop
---

# Prototype Workflow (workflows/prototype.md)

**Triggered by:** Task text contains `scaffold a new ESP-IDF prototype` or `Start a new ESP-IDF prototype`

Take the user from zero to a buildable ESP-IDF app. This workflow's specialty is **composing one app
from one or more verified ESP-IDF examples** (and registry components) — each IDF example shows a
single feature, so a real prototype is usually a *base* example plus features ported from others. No
project folder is required at entry.

**You do the work.** The user came here to have the prototype built, not to be handed a list of
examples to open themselves. Scaffold the files yourself; only fall back to "you create it" if the
user explicitly asks. Never end a step with "now go pick example X in the wizard" as the only path.

---

## Step 0: Scope gate (prototype exception)
Exempt from the "project must exist" check — proceed without `CMakeLists.txt` / `main/` / `sdkconfig`.

---

## Step 1: Decompose the request — capabilities **and** device topology
Ask what they're building if unclear:
> "What are you building? e.g. 'Wi-Fi sensor node that serves a web dashboard' or 'a BLE peripheral
> that streams ADC data'."

Parse **two** things and tell the user both:
1. **Capabilities** — discrete features (e.g. *Wi-Fi STA* + *HTTP server* + *I²C sensor* + *NVS*).
2. **Device topology** — how many devices/roles. Watch for **two-role** requests:
   - "central ↔ peripheral", "sensor node + gateway", "two boards talk over ESP-NOW"
     → **two apps, two boards**. Call it out and plan it as two.
   - Otherwise → single device.

---

## Step 2: Find a source for each capability
**MANDATORY SKILL LOAD:** `read_file` → `platforms/esp/actions/find-sample.md` and follow it to map
**each** capability to a verified IDF example (or a registry component). Do not invent paths.
- **BLE two-device:** find-sample returns a **matched pair** — `bleprph` (peripheral) ↔ `blecent`
  (central), both NimBLE so the GATT lines up. You will scaffold **both**.
- **I²C / external sensor capability:** the example is only the read loop — the board wiring (which
  `I2C_NUM`, the SDA/SCL GPIOs, the 7-bit address) lives in the **I²C sensor recipe in
  `add-feature.md`**. Note it now; apply in Step 5.

---

## Step 3: Plan the architecture — confirm with a diagram BEFORE writing
Pick the base and the ports, then **draw it and get a yes before any file is written** (core.md
rule 6).

- **Single device** → a component map (Mermaid `flowchart`): base example + the modules you'll add.
  ```mermaid
  flowchart LR
    base["wifi/station (base)"] --> http["http_server module"]
    base --> sensor["BME280 (I2C) module"]
    base --> nvs["NVS settings"]
  ```
- **Two devices** → a connection timeline (Mermaid `sequenceDiagram`) so the user sees the interaction
  you're about to build:
  ```mermaid
  sequenceDiagram
    participant P as Peripheral (bleprph)
    participant C as Central (blecent)
    P->>C: advertise
    C->>P: connect + GATT discover + subscribe
    P-->>C: notify (sensor data)
  ```
  State plainly: **"This is two apps on two boards."** Then:
> *"Here's the planned architecture — base = `<example>`, then I add `<cap2>`, `<cap3>`. Scaffold it?"*

**Composition rule (single device):** one capability/one example → that example is the base. Multiple
→ base = the most infrastructure-heavy example (usually the connectivity one, e.g. `wifi/station` or
`bleprph`); the rest become **ports**. If none dominates, base = `get-started/hello_world`.

---

## Step 4: Scaffold the base — **you create it** (don't send the user to the wizard)
First ask **where** to create it (destination folder + app name) — the only thing you need from the
user. Then build it yourself:

- **Default — agent-driven file copy (robust, headless):** copy the chosen IDF example into the
  destination with `read_file` + `write_to_file` — the top `CMakeLists.txt`, `main/` (`main.c`,
  `main/CMakeLists.txt`, any `idf_component.yml`), `sdkconfig.defaults`, `partitions.csv` if present.
  Rename `project(<name>)` in the top `CMakeLists.txt` to the app name.
- **Registry-example base:** if find-sample chose a component example, use
  `triggerEspAction` action="execute" command="`idf.py create-project-from-example "namespace/name=^x:example"`"
  into the destination instead of copying by hand.
- **Blank base:** the minimal 3-file app — top `CMakeLists.txt`
  (`include($ENV{IDF_PATH}/tools/cmake/project.cmake)` + `project(<name>)`), `main/CMakeLists.txt`
  (`idf_component_register(SRCS "main.c")`), and `main/main.c` (`void app_main(void)`).

Offer the choice as buttons:
> Options: `["Scaffold it for me", "I'll create it from the example myself"]`

**Set the target before the first build:** `idf.py set-target <chip>` for the connected chip
(`rules/device-identity.md`). **Two-device:** scaffold **both** apps the same way (e.g.
`myproj/central/` and `myproj/peripheral/`), each a full app with its own `build/`. Confirm with
`list_files`. Do **not** add license headers (user's job).

---

## Step 5: Port the remaining capabilities (compose)
For **each** remaining capability from Step 3, one at a time:
- **MANDATORY SKILL LOAD:** `read_file` → `platforms/esp/workflows/add-feature.md` and follow it to
  port that capability into the base (C module + `main/CMakeLists.txt` `REQUIRES` + any Kconfig /
  managed dependency).
- **I²C / external sensor:** use add-feature's **I²C sensor recipe** — the `i2c_master` bus setup, the
  right GPIOs, the **7-bit address**, pull-ups. A driver/config change needs a rebuild.

Build between ports if the user wants early validation.

---

## Step 6: Build, flash & iterate — through the Debug Loop ONLY, never freehand
Hand off to the Debug Loop to prove the scaffold compiles and runs:
> "Scaffold ready. Want me to build and flash it to confirm it runs on your board?"

- **MANDATORY SKILL LOAD:** if the user agrees, `read_file` → `platforms/esp/workflows/debug-loop.md`
  and run the **whole** loop — Build → Flash → **Capture → Analyze** — loading each phase's Action per
  the Command Gate. Never issue `idf.py build`/`flash`/`monitor` from memory because "the prototype is
  simple" — that try-and-error path is the documented failure mode. A capture you never analyze proves
  nothing; the **first** build after `set-target` is from a clean tree.
- **Two-device build & flash:** build each app in its own dir, flash each to its **own board by port**
  (resolve ports with `python -m serial.tools.list_ports`; pass `port=` every time). Confirm the
  central/peripheral board assignment with the user before flashing — never assume which port is which.
- Then invite the next loop: *"Want to add another feature on top of this?"* → `add-feature.md`.
