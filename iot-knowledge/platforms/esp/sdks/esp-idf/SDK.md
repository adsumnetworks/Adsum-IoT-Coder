# SDK Reference: ESP-IDF v5.5 (sdks/esp-idf/SDK.md)

ESP-IDF (Espressif IoT Development Framework) is the official development framework for ESP32 chips.

## Build System (CMake & `idf.py`)

ESP-IDF utilizes CMake as its build system, but wraps it in the Python utility `idf.py`.

### Project Structure (Typical)
```text
my-project/
├── CMakeLists.txt         ← Project-level CMake (project name)
├── sdkconfig              ← Auto-generated configuration (do not edit manually)
└── main/
    ├── CMakeLists.txt     ← Component-level CMake (source files, dependencies)
    └── main.c             ← Application entry point (app_main)
```

### Essential `idf.py` Usage
Always remember to source the environment first (see `rules/esp-terminal.md`).

1. **Set Target:** `idf.py set-target esp32` (Ensures the correct toolchain and SDK configurations are used).
2. **Configure:** `idf.py menuconfig` (Use headless/scripted config for agents unless user requests CLI UI).
3. **Build:** `idf.py build` (See `actions/build.md`).
4. **Flash:** `idf.py -p <PORT> flash` (See `actions/flash.md`).
5. **Monitor:** `idf.py -p <PORT> monitor` (See `actions/capture-logs.md`).
6. **Full Chain:** `idf.py -p <PORT> flash monitor`

## FreeRTOS Foundation

ESP-IDF is built entirely around an SMP (Symmetric Multiprocessing) capable version of **FreeRTOS**.
- The main entry point is `void app_main(void)`.
- `app_main` is executed by the main FreeRTOS task. It can return (the task will be deleted), meaning you must spin off child tasks via `xTaskCreate` or `xTaskCreatePinnedToCore` for background loops.
- Avoid placing `while(1)` inside `app_main` without `vTaskDelay`, or the watchdog will kill the task.

## Configuration (Kconfig)

Configuration is managed via `Kconfig`. 
To modify configurations programmatically without interacting with the terminal UI:
- Directly write to `sdkconfig.defaults` and run `idf.py reconfigure`.
- Example for enabling Wi-Fi AP support: create `sdkconfig.defaults` with `CONFIG_ESP_WIFI_SOFTAP_SUPPORT=y`

## Event Loop Library

ESP-IDF uses a centralized Event Loop (`esp_event.h`) for handling system events (Wi-Fi connected, IP acquired, etc.).
- You MUST initialize it via `esp_event_loop_create_default()` early in `app_main()`.
- Use `esp_event_handler_instance_register()` to subscribe to events.
