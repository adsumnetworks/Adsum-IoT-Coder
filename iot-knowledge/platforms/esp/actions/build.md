---
id: adsum/esp/actions/build
title: "Action: Build Firmware"
type: action
version: 1.0.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: esp
---

# Action: Build Firmware (actions/build.md)

## When Used
Called from: Debug Loop Phase 1, App Generator, or any task requiring a firmware build. Run via `triggerEspAction` action="build".

## Pre-conditions
- ESP-IDF project detected (`CMakeLists.txt` referencing IDF + `main/`).
- Code is saved.

## Target Resolution (BEFORE BUILDING)
You must build for the chip that is actually connected. Cross-reference the three sources from `rules/device-identity.md`:
1. **sdkconfig** → `CONFIG_IDF_TARGET` (what the project is configured for).
2. **build/project_description.json** → `target` (what was last built).
3. **Connected chip** → `triggerEspAction` action="execute" command="`esptool.py flash_id`".

| Situation | Action |
|---|---|
| All three agree | Build directly. |
| No `sdkconfig`/build yet | First build: `triggerEspAction` action="execute" command="`idf.py set-target <chip>`", confirm the chip with the user, then build. |
| Config target ≠ connected chip | **STOP** and ask which target (re-target wipes the build). See `rules/device-identity.md`. |
| No board connected | Warn, build from config; flashing will need a board. |

## Execution
```
triggerEspAction  action="build"
```
This runs `idf.py build` in the IDF environment. After a config change (edited `sdkconfig.defaults`, `CMakeLists.txt`, or `partitions.csv`), first run `triggerEspAction` action="execute" command="`idf.py reconfigure`" — or it may build stale.

## Error Handling
Extract the **key error line** — do not dump raw output.
- `undefined reference to '<sym>'` → missing source in `SRCS`, or a missing/incorrect `REQUIRES`/`PRIV_REQUIRES` in the component's `CMakeLists.txt`.
- `fatal error: <header>.h: No such file` → component not in `REQUIRES`, or include path missing.
- `... is not defined` for a `CONFIG_*` symbol → the Kconfig option isn't enabled. Use `actions/configure.md` to set it (in `sdkconfig` AND `sdkconfig.defaults`, then rebuild) — editing `sdkconfig.defaults` alone won't apply if `sdkconfig` already exists.
- `region 'iram0_0_seg' overflowed` / `DRAM segment data does not fit` → too much in IRAM/DRAM; move buffers to PSRAM (`MALLOC_CAP_SPIRAM`) or reduce static allocation.
- `Flash size ... larger than ...` → `CONFIG_ESPTOOLPY_FLASHSIZE` exceeds real flash (check `flash_id`).

On build failure, fix the root cause (do NOT blindly retry the same code). When offering choices, use `ask_followup_question`: `["Apply the fix and rebuild", "Show the full error", "Cancel"]`.

## Output
Success → binaries in `build/` (`<project>.bin`, `bootloader/bootloader.bin`, `partition_table/`), ready to flash. `build/project_description.json` records the target.
