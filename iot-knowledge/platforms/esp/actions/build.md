# Action: Build Firmware (actions/build.md)

## When Used
Called from: Debug Loop, Application Generator, or any workflow requiring firmware compilation.

## Pre-conditions
- CMake/ESP-IDF project detected.
- Code is saved.

## Target Resolution (BEFORE BUILDING)
Before calling `idf.py build`, you must ensure the device target is set correctly.
1. Check `sdkconfig` (if it exists) for `CONFIG_IDF_TARGET="esp32"`.
2. If `sdkconfig` does not exist or target is missing, run:
   ```bash
   . /home/omar/esp/v5.5.2/esp-idf/export.sh && idf.py set-target <target_name>
   ```
   (e.g., `idf.py set-target esp32`).

## Execution

To build the firmware, execute the following in a shell:
```bash
. /home/omar/esp/v5.5.2/esp-idf/export.sh && idf.py build
```

## Error Handling
On failure, `idf.py` will print CMake or Ninja errors.
- Read the terminal output and identify the **exact compiler error line**.
- Common compilation errors: syntax in `.c` files, missing includes, undefined references.
- Missing Kconfig variables: If the user requests a feature (like Wi-Fi AP) but the code fails stating `CONFIG_ESP_WIFI_SOFTAP_SUPPORT` is not defined, you must add it to `sdkconfig.defaults` and run `idf.py reconfigure`.

## Output
If successful, the build produces binary files in the `build/` directory, ready to be flashed.
