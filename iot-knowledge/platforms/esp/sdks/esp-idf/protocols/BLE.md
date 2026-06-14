---
id: adsum/esp/sdks/esp-idf/protocols/ble
title: "Protocol: BLE"
type: knowledge
version: 1.0.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: esp
---

# Protocol: BLE (NimBLE) (sdks/esp-idf/protocols/BLE.md)

## When Used
Load when the project enables Bluetooth LE (`CONFIG_BT_ENABLED=y`). ESP-IDF ships two BLE host stacks;
**NimBLE** is the default and recommended one (BLE-only, smaller RAM/flash footprint). **Bluedroid**
is the alternative (Classic BT + BLE, larger). Tell which from `sdkconfig`:
- NimBLE: `CONFIG_BT_NIMBLE_ENABLED=y`
- Bluedroid: `CONFIG_BT_BLUEDROID_ENABLED=y`

The exact API differs between the two — confirm which host is enabled before writing code. The notes
below are for NimBLE (the common case); ground exact calls from the IDF examples via `find-sample.md`.

## Init order (NimBLE, in `app_main`)
BLE needs NVS first (it stores the bonding/calibration data), then the controller + host:
1. `nvs_flash_init()` (same guard as Wi-Fi — erase+retry on `NO_FREE_PAGES`).
2. `nimble_port_init()` — brings up the controller + host.
3. Register the host callbacks: `ble_hs_cfg.sync_cb` (advertise/scan starts **here**, not before sync)
   and `ble_hs_cfg.reset_cb`.
4. For a GATT server: `ble_gatts_count_cfg()` + `ble_gatts_add_svcs()` with your service table.
5. Start the host task: `nimble_port_freertos_init(<host_task>)`.

> Common trap: starting advertising/scanning **before** the stack sync callback fires → it silently
> does nothing. Always kick off GAP from `sync_cb`.

## Roles & the matched example pair
| Role | What it does | IDF example |
|---|---|---|
| **Peripheral** (GATT server) | advertises, accepts a connection, exposes characteristics | `examples/bluetooth/nimble/bleprph` |
| **Central** (GATT client) | scans, connects, discovers + subscribes | `examples/bluetooth/nimble/blecent` |
| Peripheral + standard service | heart-rate notify | `examples/bluetooth/nimble/blehr` |

A "two boards talk over BLE" request is **two apps** — pair `bleprph` ↔ `blecent` so the GATT service
lines up (see `workflows/prototype.md` two-device handling).

## Common failure modes (for log analysis)
- **Never advertises / not visible:** GAP started before `sync_cb`, or `CONFIG_BT_NIMBLE_ENABLED` not set.
- **Connects then drops:** look at the `BLE_GAP_EVENT_DISCONNECT` **reason code** in the log — e.g.
  `0x08` connection timeout (range/interference), `0x13` remote user terminated, `0x3d` MIC failure
  (bonding/security mismatch). Report the reason, don't guess.
- **Coexists with Wi-Fi:** BLE + Wi-Fi share the radio; current spikes can trigger a brownout
  (`analyze-logs.md` §5) — suspect power before code on a reset under load.
- **Out of memory bringing up the host:** raise `CONFIG_BT_NIMBLE_*` buffer counts only as needed;
  don't blanket-max them.

## Deeper logs
Raise just the BLE tag for a scenario instead of a global bump:
`esp_log_level_set("NimBLE", ESP_LOG_DEBUG);` (see `workflows/log-generator.md`). Avoid global
`VERBOSE` — it floods the UART and can disturb timing.

## Reference
NimBLE API + examples are under the IDF **Bluetooth → NimBLE** docs; pull exact signatures from the
`bleprph` / `blecent` example sources via `find-sample.md` rather than from memory.
