# Action: Build Firmware (actions/build.md)

## When Used
Called from: Debug Loop Phase 1, Log Generator Step 6, or any task requiring firmware build and flash.

## Pre-conditions
- Project detected (CMakeLists.txt + prj.conf)
- Board target known (from `build_info.yml` or user selection)
- nRF Connect Terminal available

## Execution — NCS/Zephyr (`west build`)

### Standard Build
```bash
west build -b <board>/<soc>
# Example: west build -b nrf52840dk/nrf52840
```

### Incremental Build (no config changes)
```bash
west build
```
If a previous build exists with the same board, `west build` rebuilds incrementally.

### Pristine Build (REQUIRED after config changes)
If `prj.conf`, any `.conf` overlay, or any DeviceTree file (`.overlay`, `.dts`) has been modified:
```bash
west build -t pristine
west build -b <board>/<soc>
# Example: west build -b nrf52dk/nrf52832 -t pristine
```
**CRITICAL:** Failing to do a pristine build after Kconfig/DT changes causes stale config bugs that are extremely hard to diagnose.

### Multi-Build Directory
If the project has multiple build folders (e.g., one per board):
```bash
west build -b <board>/<soc> -d <build_directory>
# Example: west build -b nrf52dk/nrf52832 -d build_peripheral
```

### Sysbuild (nRF5340 Dual-Core)
For nRF5340 projects that need both application and network core:
```bash
west build --sysbuild -b nrf5340dk/nrf5340/cpuapp
```
This builds both cores and their dependencies.

### Menuconfig (Interactive Kconfig)
```bash
west build -t menuconfig
```

## Error Handling
- Extract the **key error line** from the build output — do not dump raw terminal output.
- Common patterns:
  - `error: Aborting due to Kconfig warnings` → incorrect Kconfig symbol
  - `fatal error: <header>.h: No such file or directory` → missing module or wrong include path
  - `region 'FLASH' overflowed` → binary too large, disable unused features
  - `region 'RAM' overflowed` → reduce stack sizes or disable features
- On build failure, always offer: `["Attempt auto-fix", "Show full error", "Cancel"]`

## Output
Build succeeds → `build/zephyr/zephyr.hex` (or `<build_dir>/zephyr/zephyr.hex`) is ready for flashing.
