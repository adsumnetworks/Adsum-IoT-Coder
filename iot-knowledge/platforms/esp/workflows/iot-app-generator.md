# Workflow: IoT App Generator (workflows/iot-app-generator.md)

## Description
This workflow guides the generation of an "IoT Sensor/Gateway node with Wi-Fi Settings & Web Dashboard" using ESP-IDF v5.5.

## Required Skills (Do NOT skip)
Before writing any code, you MUST load and read the following rule and action files to understand ESP32 constraints:
- `MANDATORY SKILL LOAD`: `sdks/esp-idf/protocols/WIFI.md` 
- `MANDATORY SKILL LOAD`: `actions/web-dashboard-dev.md`

## Code Generation Strategy

When tasked with creating an IoT app with a web dashboard, generate the files using the following architectural pattern:

### 1. Build System (`CMakeLists.txt`)
- Generate the root `CMakeLists.txt` and `main/CMakeLists.txt`.
- Add required `REQUIRES` components in `main/CMakeLists.txt` (e.g., `nvs_flash`, `esp_wifi`, `esp_http_server`).

### 2. The Frontend (`main/webpage.h`)
- Follow the guidelines in `web-dashboard-dev.md`.
- Create a `const char* PROGMEM index_html = R"=====( ... )=====";` block containing the full HTML/JS/CSS.
- Use `fetch('/api/data')` polling to update sensor values dynamically.

### 3. The Backend (`main/main.c`)
Implement the backend in several logical blocks:
1. **Global State:** Create global variables or FreeRTOS Queues/Mutexes to store sensor readings safely.
2. **Wi-Fi Subsystem:** Implement the mandatory Wi-Fi initialization sequence from `WIFI.md`. Setup event handlers for STA or AP mode.
3. **HTTP Server Subsystem:**
   - Create URI handler for `/` (serves `index_html`).
   - Create URI handler for `/api/data` (returns JSON string with current sensor readings).
4. **Sensor Subsystem Task:** 
   - Write a FreeRTOS Task (e.g., `sensor_task`) that runs in an infinite loop with `vTaskDelay`, reading the sensor (e.g. DHT11) and updating the global state.
5. **Main Entry (`app_main`):**
   - Initialize NVS.
   - Initialize Wi-Fi.
   - Spawn `sensor_task` using `xTaskCreate`.
   - The HTTP server should be started inside the `IP_EVENT_STA_GOT_IP` event handler (or when AP starts).

## Completion
Once the code is generated, prompt the user to use the **Debug Loop** workflow to compile, flash, and test the firmware.
