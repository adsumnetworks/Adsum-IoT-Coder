# Nordic nRF Connect SDK / Zephyr RTOS — Platform Knowledge

## CRITICAL RULE: nRF Connect Terminal
**ALL SDK commands MUST be executed inside the nRF Connect terminal.**
The nRF Connect terminal (provided by the nRF Connect for VS Code extension) pre-loads
the Zephyr/NCS toolchain environment (`ZEPHYR_BASE`, `GNUARMEMB_TOOLCHAIN_PATH`, west, etc.).
Running commands in a regular shell will **fail** because the environment is not configured.

If the nRF Connect terminal cannot be opened, or `west --version` / `nrfutil --version` fails inside it,
the user **must install and configure the nRF Connect for VS Code extension** before any development can proceed.

The agent tool `nrf_device_tool` already routes commands through the nRF Connect terminal.
**ALWAYS use `nrf_device_tool`** for any build, flash, log, or shell operation. **NEVER** use `execute_command` directly.

## NCS Project Structure
A standard nRF Connect SDK application contains:
```
<project-root>/
├── CMakeLists.txt        # Must contain: find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
├── prj.conf              # Kconfig configuration (always present)
├── src/
│   └── main.c            # Application entry point
├── boards/               # (optional) Board-specific overlays: <board>.overlay, <board>.conf
├── sample.yaml           # (optional) Sample metadata & test definitions
├── .overlay / .dts       # (optional) DeviceTree overlays at root level
├── build/                # Generated build artifacts (never edit manually)
│   ├── zephyr/zephyr.hex # Compiled firmware image
│   └── merged.hex        # Combined image (app + bootloader if applicable)
└── .vscode/settings.json # nRF Connect extension workspace settings
```

## SDK Installation Path
The NCS SDK is typically installed at:
- **Linux:** `~/ncs/<version>/` (e.g. `/home/<user>/ncs/v3.2.1/`)
- **Windows:** `C:\ncs\<version>\`
- **macOS:** `~/ncs/<version>/`

Inside the SDK: `nrf/`, `zephyr/`, `modules/`, `bootloader/`, `tools/`, `nrfxlib/`
The `west.yml` manifest lives inside the SDK (`nrf/west.yml`), NOT in user projects.

## Supported Boards (nRF52 Series — Test Targets)
| Board Target             | SoC        | Features                        |
|--------------------------|------------|---------------------------------|
| `nrf52840dk/nrf52840`    | nRF52840   | BLE 5.0, USB, NFC, Thread, Zigbee, 802.15.4 |
| `nrf52dk/nrf52832`       | nRF52832   | BLE 5.0, NFC                    |

Board targets use the format `<board>/<soc>` (e.g. `nrf52840dk/nrf52840`).

## Key Configuration Files
### prj.conf (Kconfig)
Controls what subsystems and features are enabled:
```ini
CONFIG_BT=y                      # Enable Bluetooth
CONFIG_LOG=y                     # Enable logging subsystem
CONFIG_USE_SEGGER_RTT=y          # Enable RTT transport
CONFIG_LOG_BACKEND_RTT=y         # Route logs to RTT
CONFIG_LOG_BACKEND_UART=y        # Route logs to UART
CONFIG_BT_PERIPHERAL=y           # BLE peripheral role
CONFIG_BT_DEVICE_NAME="MyDevice" # BLE device name
```

### CMakeLists.txt
Must always reference Zephyr:
```cmake
cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(<app-name>)
target_sources(app PRIVATE src/main.c)
```

### DeviceTree Overlays (.overlay)
Board-specific hardware customization placed in `boards/` directory.
Named `<board_target>.overlay` (e.g. `nrf52840dk_nrf52840.overlay`).

## Build & Flash Workflow
```bash
# Build (via nrf_device_tool — runs in nRF Connect terminal)
west build -b nrf52840dk/nrf52840

# Flash (device must be connected)
west flash

# Clean build
west build -t pristine
```

## Logging & Debugging
### Auto-detect Log Transport from prj.conf:
- `CONFIG_USE_SEGGER_RTT=y` → **RTT** (via J-Link / nRF Connect debugger)
- `CONFIG_LOG_BACKEND_UART=y` → **UART** (serial port)
- Both can be enabled simultaneously

### Log Capture
Use `nrf_device_tool` with `action="log_device"` to capture device logs.
The tool auto-detects the transport from `prj.conf`.

### Useful nRF CLI Tools (all via nRF Connect terminal)
- `west --version` — Check west build tool version
- `nrfutil device list` — List connected J-Link devices, best for: 
    - get the port number to be used for UART logging
    - get the serial number for RTT logging and flashing
    - get the available device traits (like `serialPorts` - Device has serialports).
- `nrfutil device device-info` — List connected J-Link devices, best for:
    - get the device info like deviceFamily, deviceName, deviceVersion ...
- `nrfutil toolchain-manager list` — Show installed NCS SDK versions 
- `west build -t menuconfig` — Interactive Kconfig editor

IMPORTANT: If the nRF Connect terminal cannot excute `nrfutil device` the agent should install it using `nrfutil install device`.and it's CRITICAL to have nrfutil installed in the nRF Connect terminal for devices info and interactive debugging.(same thing for toolchain-manager `nrfutil install toolchain-manager`)

## NCS Documentation Reference (SINGLE SOURCE OF TRUTH)
When the SDK is installed, detailed documentation is absolutely critical and serves as your single source of truth.
You MUST refer to the documentation in `/home/{user}/ncs/{version}/nrf/doc` (Should be using `nrfutil toolchain-manager list` to get the path and versions of the installed SDKs) whenever you need details on best practices, configs, or integrations.
Subdirectories include:
- `app_dev/` — Application development guides
- `app_dev/config_and_build/` — Build system, Kconfig, CMake docs
- `app_dev/device_guides/nrf52/` — nRF52 specific guides
- `samples/` — Sample application docs
- `protocols/` — BLE, Thread, Zigbee, Matter protocol guides
- `libraries/` — NCS library references
**IMPORTANT**: This documnentation has a lot of files and informations, so you should use it carfully ONLY when you need a detail that not mention in this iot-knowledge. YOU SHOULND NOT fill-up the context that yiled to bad peformence, context overflow and high cost.

## Zephyr Documentation Reference (SINGLE SOURCE OF TRUTH)
You MUST refer to the documentation in `/home/{user}/ncs/{version}/zephyr/doc` (Should be using `nrfutil toolchain-manager list` to get the path and versions of the installed SDKs) whenever you need details on best practices, configs, or integrations.
- 'west' documentation is in `/home/{user}/ncs/{version}/zephyr/doc/develop/west/` and for build/flash doc, you should refer to `build-flash-debug.rst` in that folder.

**IMPORTANT**: This documnentation has a lot of files and informations, so you should use it carfully ONLY when you need a detail that not mentioned in this context (IoT & Embedded Context). YOU SHOULND NOT fill-up the context that yiled to bad peformence, context overflow and high cost.


## Debugging Workflows
Refer to the `workflows/` directory for step-by-step instructions on:
- **Log Generation** — Capturing device logs (RTT / UART)
- **Log Analysis** — Parsing and interpreting device output
- **Debug Loop** — Iterative build-flash-test cycle with safety guards
