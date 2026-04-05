# Log Generator Workflow

**Triggered by:** Prompts like "Generate logging code", "Add logs", "Add LOG macros", "Help me debug with logs"

This workflow adds NCS-compliant Zephyr logging (`LOG_*` macros) to C source files and configures `prj.conf`.

---

## Step 1: Silent Workspace Analysis

Read `environment_details` (provided automatically). For EACH VS Code workspace root listed:
- Check for `CMakeLists.txt`, `prj.conf`, and `src/` to confirm it is a valid nRF project.
- Check `*build*/**/build_info.yml` to identify the existing builds board (e.g., `nrf52840dk`).
- Check connected devices with `nrfutil device device-info` to get serial numbers, Ports, device type, etc. of all connected devices.
- If there is a conflit between the existing builds board and the connected devices board ask the user which board to use, so that the generated logs will be tunned to the correct board.
- Read `prj.conf` to detect the current log backend: `CONFIG_LOG_BACKEND_UART=y` or `CONFIG_LOG_BACKEND_RTT=y`.

Do NOT ask questions during this step (expect the board conflict question). Gather all context silently.

---

## Step 2: Decision Point — Single vs Multi-Project

**IF SINGLE PROJECT:**
- Report briefly: *"Found project `<name>` (board: `<board>`) at `<path>`."*
- Immediately proceed to Step 3 (Code Injection). Do NOT ask for confirmation.

**IF MULTIPLE PROJECTS:**
- Report briefly: *"Found `<ProjectA>` (`<boardA>`) and `<ProjectB>` (`<boardB>`)."*
- Use `ask_followup_question` with buttons:
  - Question: *"Which project(s) should I add logging to?"*
  - Options: `["Add to all projects", "Only <ProjectA>", "Only <ProjectB>"]`
- Wait for the user's button selection before proceeding.

---

## Step 3: Code Injection

For each selected project:
1. Add `#include <zephyr/logging/log.h>` at the top of the relevant `.c` file(s).
2. Add `LOG_MODULE_REGISTER(<module_name>, LOG_LEVEL_DBG);` after the includes.
3. Inject `LOG_INF`, `LOG_DBG`, `LOG_WRN`, `LOG_ERR` macros at strategic locations:
   - Function entry/exit points for key subsystems.
   - Before and after hardware initialization calls.
   - BLE event callbacks (if applicable).
   - Error handling branches.

**Constraint:** Apply the code directly. Do not write a markdown plan about what you are going to do — just do it.

---

## Step 4: Post-Generation — RTT Check (Required)

After code injection, check `prj.conf` for the log backend:

**IF UART backend (`CONFIG_LOG_BACKEND_UART=y` or no RTT config found):**
Use `ask_followup_question`:
- Question: *"Logging injected ✅. You're currently using UART. For embedded/BLE projects, J-Link RTT is recommended — it's faster and doesn't interfere with wireless protocols. Switch to RTT?"*
- Options: `["Enable RTT in prj.conf", "Keep UART logging"]`

If user selects "Enable RTT": update `prj.conf` to add:
```ini
CONFIG_USE_SEGGER_RTT=y
CONFIG_LOG_BACKEND_RTT=y
# CONFIG_LOG_BACKEND_UART is not needed with RTT
```

**IF RTT already configured:** Skip this step and continue to Step 5.

---

## Step 5: Post-Generation — BLE Stack Check (Optional)

If the project contains BLE (`CONFIG_BT=y` in `prj.conf`), use `ask_followup_question`:
- Question: *"Would you like deeper BLE stack logs (connection events, GATT, security)?"*
- Options: `["Yes, enable BLE stack logs", "No, current logs are enough", "Check the logs first"]`

### BLE Stack Logging — Bug-Class Quick Reference
#### NCS 3.2.1 / Zephyr · per-module log levels (0=OFF … 4=DBG)
#### DO NOT enable all at once. Enable only what matches the bug. Set others to 0.
#### NOTE: CONFIG_BT_DEBUG_LOG is deprecated in NCS 3.x — use per-module options below.


| Bug / Symptom | Enable at DBG (=4) | Key log signals |
|---|---|---|
| **Advertising not discovered** | `BT_HCI_CORE_LOG_LEVEL`, `BT_SCAN_LOG_LEVEL` | `adv_timeout`, `Filter not matched` |
| **Connection never established** | `BT_HCI_CORE_LOG_LEVEL`, `BT_CONN_LOG_LEVEL` | `conn_complete status Y` (Y≠0 = HCI error code) |
| **Connection drops unexpectedly** | `BT_CONN_LOG_LEVEL`, `MPSL_LOG_LEVEL` | `disconnect reason 0x08` = supervision timeout / MPSL starvation |
| **Conn params not updating** | `BT_HCI_CORE_LOG_LEVEL`, `BT_CONN_LOG_LEVEL`, `BT_L2CAP_LOG_LEVEL` | `le_conn_update_complete`, `conn param req/updated` |
| **GATT read/write/notify wrong** | `BT_ATT_LOG_LEVEL`, `BT_GATT_LOG_LEVEL` | `att_err_rsp op X err Y`, `ccc_changed` (missing = client never subscribed) |
| **MTU stuck at 23 bytes** | `BT_ATT_LOG_LEVEL` | `att_mtu_exchange_req/rsp` — if absent, client never called `bt_gatt_exchange_mtu()` |
| **Pairing / bonding fails** | `BT_SMP_LOG_LEVEL`, `BT_KEYS_LOG_LEVEL`, `BT_CONN_LOG_LEVEL` | `smp err X` (0x05=not supported, 0x03=confirm failed), `bt_keys_store/find` |
| **Re-encryption fails after reconnect** | `BT_SMP_LOG_LEVEL`, `BT_KEYS_LOG_LEVEL` | `smp_security_request`, `bt_keys_find_irk`, `security_changed level` |
| **DLE / PHY not switching** | `BT_HCI_CORE_LOG_LEVEL`, `BT_CONN_LOG_LEVEL` | `le_phy_update_complete`, `le_data_len_update` — absent = feature flag missing on one side |
| **Multi-conn: one drops** | `BT_CONN_LOG_LEVEL`, `MPSL_LOG_LEVEL`, `SDC_LOG_LEVEL` | `mpsl: timeslot denied/cancelled`, `num_complete_packets` stuck at 0 |
| **Controller assertion crash** | `BT_HCI_CORE_LOG_LEVEL`, `MPSL_LOG_LEVEL`, `SDC_LOG_LEVEL` + `CONFIG_BT_CTLR_ASSERT_HANDLER=y` | `ASSERTION FAIL @ lll.c` — use RTT only, never UART in ISR context |


#### nRF5340 only
Controller (LL/radio) logs live on **Network Core**. Add to `child_image/hci_ipc.conf`:
```ini
CONFIG_MPSL_LOG_LEVEL=4
CONFIG_SDC_LOG_LEVEL=4
CONFIG_BT_CTLR_LOG_LEVEL=4
```
View via a second RTT session targeting `cpunet`.



## Step 6: Build & Flash

After all code changes are applied, use `ask_followup_question`:
- Question: *"Code is ready. How would you like to proceed with Build & Flash?"*
- Options: `["Build & Flash now (ask me each time)", "Build & Flash autonomously for this task", "I'll do it manually"]`

- If user selects "Build & Flash now": start the Debug Loop (see `debug-loop.md`) in **Ask Every Time** mode.
- If user selects "Build & Flash autonomously": start the Debug Loop in **Autonomous** mode.
- If user selects manually: end with a summary of what was changed and `<!--TASK_COMPLETE-->`.
