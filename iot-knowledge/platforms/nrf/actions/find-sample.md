# Action: Find a Sample (actions/find-sample.md)

## When Used
Called by `workflows/prototype.md` (one lookup per capability when composing an app) and
`workflows/add-feature.md` (to locate the sample whose code implements a requested feature).
**Returns** the sample path(s) to copy a feature from. Does NOT modify files.

## How to find the right sample — stop at the first hit

### 1. Curated verified index (fast path)
Match the capability to a row. Paths are relative to the NCS install root; the **module prefix
matters** — `nrf/…` are Nordic-authored, `zephyr/…` are upstream Zephyr.

**Basics — first project / no radio**
| Capability | Sample | Path |
|---|---|---|
| blink an LED / my first app | Blinky | `zephyr/samples/basic/blinky` |
| read a button / GPIO input | Button | `zephyr/samples/basic/button` |
| print to serial / hello world | Hello World | `zephyr/samples/hello_world` |

**BLE peripheral — a device a phone connects to**
| Capability | Sample | Path |
|---|---|---|
| LED/button control, custom GATT service | Peripheral LBS | `nrf/samples/bluetooth/peripheral_lbs` |
| UART-over-BLE / serial bridge / NUS | Peripheral UART | `nrf/samples/bluetooth/peripheral_uart` |
| heart rate / standard health service | Peripheral HR | `zephyr/samples/bluetooth/peripheral_hr` |
| beacon / advertise only | Beacon | `zephyr/samples/bluetooth/beacon` |

**BLE central / scanner**
| Capability | Sample | Path |
|---|---|---|
| connect to a peripheral / NUS client | Central UART | `nrf/samples/bluetooth/central_uart` |
| scan for nearby devices / observe | Observer | `zephyr/samples/bluetooth/observer` |

> **Two-device prototypes — pick a MATCHED PAIR, not one sample.** A "central talks to peripheral"
> request is **two apps**, each flashed to its own board. Pair the roles from the same family so the
> GATT service lines up: `central_uart` ↔ `peripheral_uart` (NUS, the canonical pair),
> `central_uart`/`peripheral_lbs` only if you intend a custom service. Return **both** paths and tell
> the caller this is a two-app, two-board build (see `prototype.md` two-device handling).

**Sensors / shell**
| Capability | Sample | Path | Note |
|---|---|---|---|
| read temp / humidity / pressure | BME280 | `zephyr/samples/sensor/bme280` | uses the Zephyr **sensor driver** (`compatible = "bosch,bme280"`, Sensor API) |
| generic sensor-channel polling pattern | Sensor shell / Generic | `zephyr/samples/sensor/*` | copy the fetch/get loop, not board pins |
| CLI / shell over BLE | NUS shell | `nrf/samples/bluetooth/shell_bt_nus` | |

> **An I²C sensor is devicetree-first, not just a sample copy.** The sample shows the *read loop*; the
> board-specific part (which `&i2cN`, the overlay, the 7-bit address, the nRF52 `nrf-twim` gotcha) is
> the **I²C sensor recipe in `add-feature.md`** — route there to actually wire it up.

### 2. Search the installed NCS tree (anything not in the index)
Resolve the NCS root (from `build_info.yml` `west.topdir`, or `nrfutil sdk-manager list --all-fields`),
then use the **`search_files` tool** — it reads each sample's `sample.yaml` (name/description/tags)
without loading full sources:
- `search_files` path=`<ncs>/nrf/samples`  regex=`<keyword>`  file_pattern=`sample.yaml`
- `search_files` path=`<ncs>/zephyr/samples` regex=`<keyword>` file_pattern=`sample.yaml`

Present the top candidates (path + the one-line `sample.yaml` description) and let the user confirm
before anything is copied.

### 3. Still nothing
Tell the user no verified or discovered sample matches, and ask how they'd like to proceed.

## Composable feature modules — `samples/common`
`<ncs>/nrf/samples/common/*` are feature modules **designed to be added** to other samples (e.g.
`mcumgr_bt_ota_dfu` → `CONFIG_NCS_SAMPLE_MCUMGR_BT_OTA_DFU` for BLE FOTA). When the capability is one
of these, prefer enabling its `CONFIG_NCS_SAMPLE_*` symbol over hand-porting code.

## What a sample contributes (the 3 layers the caller ports)
1. **C code** → `src/modules/<name>/`
2. **Kconfig** — the `CONFIG_*` lines from its `prj.conf`
3. **devicetree overlay** — its `boards/*.overlay`

## Rules
- Never invent a sample path or `CONFIG_*` value. If unsure, search (step 2) or ask.
- Always confirm the chosen path exists (`list_files`) before the caller copies from it.
- Keep results compact — return paths + one-liners, never full file dumps.
