---
id: adsum/nrf/sdks/ncs/protocols/ble
title: "BLE Protocol Knowledge — NCS / Zephyr"
type: knowledge
version: 1.1.0
owner: adsum-core
author: adsum
license: CC-BY-SA-4.0
tier: certified
delivery: bundled
domain: embedded-iot
platform: nrf
---

# BLE Protocol Knowledge — NCS / Zephyr (sdks/ncs/protocols/BLE.md)

## Version Reference
- **NCS version:** v3.2.1
- **Bluetooth Core Specification:** v6.2 (per Nordic Compatibility Matrix for nRF52840, nRF52832, nRF5340)

## BLE Fundamentals

### Roles
- **Peripheral:** Advertises, accepts connections, hosts GATT services (e.g., Heart Rate Sensor).
- **Central:** Scans, initiates connections, discovers and subscribes to GATT services (e.g., Gateway, Phone).
- **Observer:** Scans only, does not connect (e.g., beacon scanner).
- **Broadcaster:** Advertises only, does not accept connections (e.g., iBeacon, Eddystone).

### Key Layers (bottom-up)
1. **Physical Layer (PHY):** 1M, 2M, Coded (long range)
2. **Link Layer (LL):** Advertising, scanning, connection management, data length extension (DLE)
3. **HCI:** Host-Controller Interface (IPC on nRF5340, internal on nRF52)
4. **L2CAP:** Logical channels, credit-based flow control
5. **ATT/GATT:** Attribute protocol, services, characteristics, notifications, indications
6. **SMP:** Security Manager Protocol — pairing, bonding, encryption
7. **GAP:** Advertising parameters, connection parameters, device name

### Connection Parameters
- **Connection Interval:** 7.5 ms – 4 s (negotiated between Central and Peripheral)
- **Supervision Timeout:** Disconnect if no packets received within this window
- **Slave Latency:** Number of connection events a Peripheral can skip

## NCS/Zephyr BLE Configuration (Kconfig)

### Essential BLE Kconfig
```ini
CONFIG_BT=y                     # Enable BLE subsystem
CONFIG_BT_PERIPHERAL=y          # Peripheral role
CONFIG_BT_CENTRAL=y             # Central role
CONFIG_BT_SMP=y                 # Enable pairing/bonding
CONFIG_BT_GATT_CLIENT=y         # GATT client (for Central)
CONFIG_BT_DEVICE_NAME="MyDev"   # Advertised device name
CONFIG_BT_MAX_CONN=2            # Max simultaneous connections
```

### MTU & Data Length
```ini
CONFIG_BT_L2CAP_TX_MTU=247     # Max L2CAP TX MTU
CONFIG_BT_BUF_ACL_TX_SIZE=251  # ACL TX buffer (MTU + 4)
CONFIG_BT_BUF_ACL_RX_SIZE=251  # ACL RX buffer
CONFIG_BT_CTLR_DATA_LENGTH_MAX=251  # Controller DLE max
```

## BLE Stack Logging — Bug-Class Quick Reference

### NCS 3.x / Zephyr — Per-module log levels (0=OFF … 4=DBG)
**DO NOT enable all at once.** Enable only what matches the bug. Set others to 0.
**NOTE:** `CONFIG_BT_DEBUG_LOG` is deprecated in NCS 3.x — use per-module options below.

| Bug / Symptom | Enable at DBG (=4) | Key log signals |
|---|---|---|
| **Advertising not discovered** | `BT_HCI_CORE_LOG_LEVEL`, `BT_SCAN_LOG_LEVEL` | `adv_timeout`, `Filter not matched` |
| **Connection never established** | `BT_HCI_CORE_LOG_LEVEL`, `BT_CONN_LOG_LEVEL` | `conn_complete status Y` (Y≠0 = HCI error code) |
| **Connection drops unexpectedly** | `BT_CONN_LOG_LEVEL`, `MPSL_LOG_LEVEL` | `disconnect reason 0x08` = supervision timeout / MPSL starvation |
| **Conn params not updating** | `BT_HCI_CORE_LOG_LEVEL`, `BT_CONN_LOG_LEVEL`, `BT_L2CAP_LOG_LEVEL` | `le_conn_update_complete`, `conn param req/updated` |
| **GATT read/write/notify wrong** | `BT_ATT_LOG_LEVEL`, `BT_GATT_LOG_LEVEL` | `att_err_rsp op X err Y`, `ccc_changed` (missing = client never subscribed) |
| **MTU stuck at 23 bytes** | `BT_ATT_LOG_LEVEL` | `att_mtu_exchange_req/rsp` — absent means client never called `bt_gatt_exchange_mtu()` |
| **Pairing / bonding fails** | `BT_SMP_LOG_LEVEL`, `BT_KEYS_LOG_LEVEL`, `BT_CONN_LOG_LEVEL` | `smp err X` (0x05=not supported, 0x03=confirm failed), `bt_keys_store/find` |
| **Re-encryption fails after reconnect** | `BT_SMP_LOG_LEVEL`, `BT_KEYS_LOG_LEVEL` | `smp_security_request`, `bt_keys_find_irk`, `security_changed level` |
| **DLE / PHY not switching** | `BT_HCI_CORE_LOG_LEVEL`, `BT_CONN_LOG_LEVEL` | `le_phy_update_complete`, `le_data_len_update` — absent = feature flag missing |
| **Multi-conn: one drops** | `BT_CONN_LOG_LEVEL`, `MPSL_LOG_LEVEL`, `SDC_LOG_LEVEL` | `mpsl: timeslot denied/cancelled`, `num_complete_packets` stuck at 0 |
| **Controller assertion crash** | `BT_HCI_CORE_LOG_LEVEL`, `MPSL_LOG_LEVEL`, `SDC_LOG_LEVEL` + `CONFIG_BT_CTLR_ASSERT_HANDLER=y` | `ASSERTION FAIL @ lll.c` — use RTT only, never UART in ISR context |

### NUS Client Protocol (central_uart)

The NUS client (central role, `central_uart`) must complete two calls in `discovery_complete()`:

1. `bt_nus_handles_assign(dm, nus_client)` — stores the discovered GATT handles
2. `bt_nus_subscribe_receive(nus_client)` — writes the NUS TX characteristic CCCD so the peripheral can notify

**If `bt_nus_subscribe_receive()` is not called**, the peripheral's `bt_nus_send()` fails on every call — it has no subscriber. The `ccc_changed` event (see table above) will be absent because no client ever wrote the CCCD.

Log signature for this bug:
- Central: silent after `Service discovery completed` — no further BLE activity
- Peripheral: `Failed to send data over BLE connection` on every notification attempt, starting seconds after connection

### Deep Stack Logging — RTT Drop Prevention

When enabling multiple BLE modules at DBG level, default buffers will quickly overflow, causing dropped messages. Tune the buffers according to the SoC's available RAM and the number of modules enabled.

**Fundamentals for Deep Logging (All SoCs):**
```ini
CONFIG_LOG_MODE_DEFERRED=y
# Process logs more frequently to free buffers faster (default is often 100ms)
CONFIG_LOG_PROCESS_THREAD_SLEEP_MS=10
```

**Buffer Tuning Matrix:**
- **nRF52840 / nRF5340 app core (256KB+ RAM):**
  - **1-2 modules:** `CONFIG_SEGGER_RTT_BUFFER_SIZE_UP=8192`, `CONFIG_LOG_BUFFER_SIZE=4096`
  - **3+ modules:** `CONFIG_SEGGER_RTT_BUFFER_SIZE_UP` ranging from `16384` to `65536`, and `CONFIG_LOG_BUFFER_SIZE` up to `16384`.

- **nRF52832 (64KB RAM):**
  - **1-2 modules:** `CONFIG_SEGGER_RTT_BUFFER_SIZE_UP=4096`, `CONFIG_LOG_BUFFER_SIZE=2048`
  - **3+ modules:** `CONFIG_SEGGER_RTT_BUFFER_SIZE_UP=8192`, `CONFIG_LOG_BUFFER_SIZE=4096`. (Warning: may cause out of memory errors).

- **nRF52805 / nRF52810 / nRF52811 (24KB RAM):**
  - Deep logging is severely restricted. Enable **only 1** module at a time.
  - Maximum safe sizes: `CONFIG_SEGGER_RTT_BUFFER_SIZE_UP=2048`, `CONFIG_LOG_BUFFER_SIZE=1024`.

*Note: If a build fails with `region 'RAM' overflowed` after configuration, lower the RTT and LOG buffers iteratively.*

### BLE Disconnect Reason Codes (HCI)
| Code | Meaning | Common Cause |
|------|---------|--------------|
| `0x08` | Connection Supervision Timeout | Device out of range, interference, MPSL starvation |
| `0x13` | Remote User Terminated Connection | Peer intentionally disconnected |
| `0x16` | Connection Terminated by Local Host | Local `bt_conn_disconnect()` called |
| `0x22` | LL Response Timeout | Link layer procedure timeout (conn param update, PHY update) |
| `0x28` | Instant Passed | Timing conflict during connection update |
| `0x3E` | Connection Failed to be Established | Advertising ended before connection completed |

### nRF5340 Dual-Core BLE Logging
See `boards/nrf5340.md` for network core logging setup.

## BLE Sub-bits — Map (discovery)

These deepen specific BLE topics. They are **fetched on demand** (downloaded) — load by id when the
symptom matches. This index is how you learn they exist; don't skip them when relevant.

| id | When to load | Delivery |
|---|---|---|
| `adsum/nrf/workflows/hci-trace` | A BLE bug app/stack logs can't explain and you need host↔controller evidence: pairing fails on one side, conn params won't update, PHY won't switch, GATT works on phone not peer, controller crash, timing-sensitive BLE bug. Drives: enable monitor → capture → decode → present. | downloaded — fetched on demand |
| `adsum/nrf/sdks/ncs/protocols/ble/hci-monitor` | You already have a decoded HCI trace (`logs/hci/*.hci.log`) and need the expert layer — request→status→outcome chain reading, failure-signature table, cross-layer correlation. Loaded by the `hci-trace` workflow. | downloaded — fetched on demand |
