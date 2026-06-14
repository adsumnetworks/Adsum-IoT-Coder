# Action: Find an Example (actions/find-sample.md)

## When Used
Called by `workflows/prototype.md` (one lookup per capability when composing an app) and
`workflows/add-feature.md` (to locate the example whose code implements a requested feature).
**Returns** the example path(s) / component to copy or pull from. Does NOT modify files.

ESP-IDF ships a large, verified `examples/` tree, and the **ESP Component Registry**
(`components.espressif.com`) holds managed components — each often with its own example. These are the
two trusted sources. Never invent an example path or a `CONFIG_*` value.

## How to find the right source — stop at the first hit

### 1. Curated IDF examples index (fast path)
Match the capability to a row. Paths are relative to the IDF root — resolve it first: `$IDF_PATH`
(set in the IDF terminal) or `triggerEspAction` action="execute" command="`echo $IDF_PATH`".

**Basics — first app / no radio**
| Capability | Example path |
|---|---|
| hello world / print to serial | `examples/get-started/hello_world` |
| blink an LED | `examples/get-started/blink` |
| read GPIO / button | `examples/peripherals/gpio/generic_gpio` |

**Wi-Fi & network**
| Capability | Example path |
|---|---|
| join a Wi-Fi network (STA) | `examples/wifi/getting_started/station` |
| be an access point (AP) | `examples/wifi/getting_started/softAP` |
| HTTP server / serve a page or JSON | `examples/protocols/http_server/simple` |
| HTTP client / call a REST API | `examples/protocols/esp_http_client` |
| MQTT (TCP) | `examples/protocols/mqtt/tcp` |
| MQTT over TLS | `examples/protocols/mqtt/ssl` |
| Wi-Fi provisioning (SoftAP/BLE) | `examples/provisioning/wifi_prov_mgr` |

**BLE (NimBLE host — the IDF default)**
| Capability | Example path |
|---|---|
| BLE peripheral / GATT server | `examples/bluetooth/nimble/bleprph` |
| BLE central / GATT client | `examples/bluetooth/nimble/blecent` |
| BLE beacon / advertise only | `examples/bluetooth/nimble/blehr` (HR) or `.../bleprph` stripped |

**Peripherals / storage**
| Capability | Example path | Note |
|---|---|---|
| I²C sensor read | `examples/peripherals/i2c/i2c_simple` | the read loop; pins/address are project-specific — see the **I²C sensor recipe in `add-feature.md`** |
| SPI device | `examples/peripherals/spi_master` | |
| UART | `examples/peripherals/uart/uart_echo` | |
| NVS key/value storage | `examples/storage/nvs_rw_value` | |
| SD card / FAT | `examples/storage/sd_card/sdmmc` | |

> **An I²C sensor is config-first, not just a code copy.** The example shows the *read loop*; the
> board-specific part (which `I2C_NUM`, the SDA/SCL GPIOs, the 7-bit address, pull-ups) is the **I²C
> sensor recipe in `add-feature.md`** — route there to actually wire it up.

### 2. Search the installed IDF examples tree (anything not in the index)
Use `search_files` — it reads each example's `README.md` (title + a "supported targets" table)
without loading full sources:
- `search_files` path=`$IDF_PATH/examples` regex=`<keyword>` file_pattern=`README.md`

Present the top candidates (path + the one-line README title) and let the user confirm before copying.

### 3. ESP Component Registry (managed components & their examples)
For a capability not in the IDF tree (a specific sensor driver, a cloud SDK, a display/LVGL port),
the **Registry** is the source. Two ways to use a component:
- **Add it as a dependency** to an existing project:
  `triggerEspAction` action="execute" command="`idf.py add-dependency "namespace/name"`" (writes
  `main/idf_component.yml`; the next build downloads it into `managed_components/`).
- **Start a new project from a component's example:**
  `triggerEspAction` action="execute" command="`idf.py create-project-from-example "namespace/name=^1.0.0:example_name"`".

  Prefer **dev-time grounding via the Espressif Component Registry MCP** (`search_components` →
  `fetch_component_detailed_information`) to confirm the exact namespace/name, version and example
  name before running the command — never guess them.

### 4. Still nothing
Tell the user no verified example or component matches, and ask how they'd like to proceed.

## What an example contributes (the layers the caller ports)
1. **C code** → into `main/` or a `components/<name>/` module.
2. **CMake** — the `REQUIRES` / `PRIV_REQUIRES` from its `main/CMakeLists.txt`.
3. **Kconfig** — any `CONFIG_*` from its `sdkconfig.defaults` (Wi-Fi creds, etc. live in `menuconfig`
   under "Example Configuration" → `CONFIG_EXAMPLE_*`).
4. **Managed deps** — its `main/idf_component.yml`, if it pulls registry components.

## Rules
- Never invent an example path, component name, or `CONFIG_*` value. If unsure, search (step 2/3) or ask.
- Always confirm the chosen path exists (`list_files`) before the caller copies from it.
- Keep results compact — return paths + one-liners, never full file dumps.
