---
id: adsum/nrf/workflows/add-feature
title: Add Feature
type: workflow
version: 1.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: nrf
sdk: ncs
triggers: ["add a feature", "Add a feature to"]
requires:
  - adsum/nrf/actions/find-sample
  - adsum/nrf/workflows/debug-loop
loaded_by:
  - adsum/nrf/workflows/prototype
safety: [flash]
---

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

---

## Curated recipe: external I²C sensor (the case the agent struggles with)

An off-board I²C sensor (BME280, SHT4x, BH1749, …) is **not** code-first — it's **devicetree-first**.
Skipping the overlay is the #1 reason "the sensor doesn't read." Ground exact pins/driver from the
board DTS and `resource://nordicsemi/embedded-code-guidance-ncs-zephyr`; never invent psels.

**1. Pick the controller (don't guess).** The sensor hangs off one specific `&i2cN` node — which one
depends on the SDA/SCL pins it's wired to. Confirm from the board schematic or the VS Code **DeviceTree
viewer**; different parts expose different controllers (`i2c0`/`i2c1` on nRF52, `i2c1`/`i2c2` on nRF53,
`i2c21`/`i2c22` on nRF54L). If the sensor is already a child node in the board DTS (e.g. Thingy:91),
there is **nothing to add** — just enable the driver.

**2. Add the overlay** at `boards/<board>_<soc>.overlay` (board target with `/` → `_`, e.g.
`nrf52840dk_nrf52840.overlay`). Two ways to declare the sensor — **prefer the driver path**:

| Path | When | Node `compatible` | App code |
|---|---|---|---|
| **Zephyr sensor driver** (preferred) | a driver exists in NCS/Zephyr | the real part, e.g. `bosch,bme280` | Sensor API: `sensor_sample_fetch()` + `sensor_channel_get()` |
| **Raw I²C** | no driver, or you need register-level access | `i2c-device` | `i2c_dt_spec` + `i2c_write_read_dt()` |

```dts
&i2c1 {
    status = "okay";
    /* nRF52 GOTCHA: if reads fail with -5 / "bus not ready", force the TWIM binding —
       the default "nordic,nrf-twi" can fail on nRF52. */
    compatible = "nordic,nrf-twim";
    pinctrl-0 = <&i2c1_default>;
    pinctrl-1 = <&i2c1_sleep>;
    pinctrl-names = "default", "sleep";

    bme280: bme280@76 {            /* address is 7-bit — see gotcha below */
        compatible = "bosch,bme280";
        reg = <0x76>;
        status = "okay";
    };
};
```

**3. Kconfig** → `prj.conf`: always `CONFIG_I2C=y`. Driver path also needs `CONFIG_SENSOR=y` + the
part symbol (e.g. `CONFIG_BME280=y`).

**4. Address gotcha (7-bit only).** `reg`/`@unit-address` is the **7-bit** address. BME280 = `0x76`
when SDO→GND, `0x77` when SDO→VDD. If a datasheet lists separate read/write addresses (8-bit incl. the
R/W bit), use only the top 7 bits.

**5. Verify before use:** `device_is_ready(dev_i2c.bus)` (raw) or `device_is_ready(dev)` (driver). A
first-read sanity check is the chip-ID register.

**6. Overlay is a DT change → pristine build** (`west build -p`, per `actions/build.md`). A normal
incremental build will silently keep the old devicetree and the sensor stays invisible.

---

<!-- TODO (next iteration): curated recipes for Zephyr shell / BLE GATT service / NVS, grounded in
     resource://nordicsemi/embedded-code-guidance-ncs-zephyr -->

---

## Step 5: Verify the feature through the FULL Debug Loop (not just build+flash)
A feature is **proven** only by a captured log showing it running — never by a successful flash.
> "Feature applied. Want me to build, flash, and watch the logs to confirm it actually works?"

- **MANDATORY SKILL LOAD:** if yes, `read_file` → `platforms/nrf/workflows/debug-loop.md` and run the
  **whole** loop: Build → Flash → **Capture → Analyze** (each phase loads its own Action per the
  Command Gate). Stopping after flash is an unfinished verification — do not end the task there.
  A config/DT change requires a **pristine** build (see `actions/build.md`).
- **Know what "working" looks like before you capture:** from the code you just added, note the
  `LOG_INF`/`printk` lines that mark the feature's success (e.g. a sensor reading, `"Service
  registered"`). In Analyze, check the captured log for them — if they're absent or a fault appears,
  that's a failed verification: propose the fix and loop, don't declare success.
- Once the log confirms it, invite the next iteration: *"Want to add another feature on top?"* (loop here).
