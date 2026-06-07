# ESP Platform Rule: Device Identity (rules/device-identity.md)

**STRICT — Know exactly what hardware you are targeting BEFORE you build or flash. Never guess the chip.**

An ESP-IDF binary is built for **one** target (`esp32`, `esp32s3`, `esp32c3`, `esp32c6`, …). Flashing a binary built for the wrong target bricks the boot or fails to flash. So before the first build/flash, establish the identity from three sources and reconcile them.

## The three sources of truth

| Source | How to read it | Tells you |
|---|---|---|
| **sdkconfig (config intent)** | `read_file` `sdkconfig` → `CONFIG_IDF_TARGET`, `CONFIG_SPIRAM*`, `CONFIG_ESPTOOLPY_FLASHSIZE` | What the project is configured to build for; PSRAM enabled/mode; expected flash size |
| **Build artifact (what was built)** | `read_file` `build/project_description.json` → `target` | What the existing binary was actually built for |
| **Connected chip (live hardware)** | `triggerEspAction` action="execute" command="`esptool.py flash_id`" | Real chip type, revision, features (WiFi/BLE), and **flash (ROM) size** |

## Discovery sequence (first build/flash in a task)

1. **Find the port FIRST** (once, before any flash/monitor):
   `triggerEspAction` action="execute" command="`python -m serial.tools.list_ports`"
   → lists ports **without connecting** (fast). Pick the ESP one: Linux `/dev/ttyACM*` or `/dev/ttyUSB*`, macOS `/dev/cu.usbserial-*` / `/dev/cu.usbmodem*`, Windows `COMx`. **Remember this port for the whole task.**
2. **Identify the chip + flash** (pass the port so esptool doesn't scan every device):
   `triggerEspAction` action="execute" command="`esptool.py -p <port> flash_id`"
   → e.g. `Chip is ESP32-S3 (QFN56) (revision v0.2)`, `Features: WiFi, BLE`, `Detected flash size: 8MB`.
   (On ESP32-S3 `chip_id` says *"has no Chip ID, reading MAC instead"* — that's normal; `flash_id` is the better single call.)
3. **IDF version:** `triggerEspAction` action="execute" command="`idf.py --version`".
4. **PSRAM** is a **config** fact, not an esptool read: check `sdkconfig` for `CONFIG_SPIRAM=y` and `CONFIG_SPIRAM_MODE_*` (quad/octal). It is **confirmed at runtime** by the boot log line `Found 8MB SPI RAM device` once you capture logs.
5. **App memory footprint** (after a build): `triggerEspAction` action="execute" command="`idf.py size`" → IRAM / DRAM / Flash usage.

## Port rule (avoid the 30-port scan; survive two boards)
- **Discover the port once (step 1), then ALWAYS pass it** as `port="<port>"` to every `flash` and `monitor`.
- Flashing/monitoring **without** a port makes esptool open *every* serial device (`/dev/ttyS0`…`ttyS31` on Linux) one by one — dozens of "port is busy or doesn't exist" lines before it finds the real one. Passing `port=` skips all of that.
- With **two boards connected**, auto-detect may pick the wrong one — the explicit port is the only safe choice. If `list_ports` shows two ESP ports, ask the user which board to target.

## Reconciliation matrix (NEVER skip on mismatch)

| sdkconfig target | Build artifact | Connected chip | Action |
|---|---|---|---|
| esp32s3 | esp32s3 | esp32s3 | Match → build for `esp32s3`. |
| (any) | — (no build) | esp32s3 | First build — set target: `idf.py set-target esp32s3`, confirm with user. |
| esp32 | esp32 | **esp32s3** | **STOP.** Ask: *"Project is configured for esp32 but the connected board is esp32-s3. Re-target to esp32-s3 or keep esp32?"* Options: `["Re-target to the connected chip", "Keep the project target", "Let me explain"]` |
| esp32s3 | esp32s3 | (none connected) | Warn: *"No board detected. I'll build for esp32s3 from config; flashing needs a connected board."* |

**Target confirmation is never silently auto-resolved**, even in Auto-Approve mode. Re-targeting wipes the build (`idf.py set-target` implies a fullclean), so always confirm first.
