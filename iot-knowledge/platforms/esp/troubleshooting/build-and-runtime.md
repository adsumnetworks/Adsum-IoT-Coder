# Troubleshooting: Build & Runtime Issues (`troubleshooting/build-and-runtime.md`)

## Build Issues

### Issue: Undefined Reference to `app_main`

**Error:**
```
undefined reference to `app_main'
```

**Root Cause:**
`main/CMakeLists.txt` does not include `main.c` in the `SRCS` list, or `PRIV_REQUIRES` is incorrectly used for `app_main`.

**Solution:**

❌ **WRONG:**
```cmake
idf_component_register(
    SRCS                    # Empty source list!
    INCLUDE_DIRS "."
    PRIV_REQUIRES esp_http_server
)
```

✅ **CORRECT:**
```cmake
idf_component_register(
    SRCS "main.c"           # Explicitly include main.c
    INCLUDE_DIRS "."
    REQUIRES esp_http_server nvs_flash esp_wifi
)
```

**Note:** Use `REQUIRES` for dependencies needed by `app_main()`. Use `PRIV_REQUIRES` for private component dependencies only.

---

### Issue: String Literal Quote Errors During Compilation

**Error:**
```
error: missing terminating " character
```

**Root Cause:**
Embedded HTML/JavaScript in C strings has unbalanced quotes or missing `\n` terminators. See `patterns/embedded-html-pattern.md`.

**Solution:** Ensure each concatenated string line:
1. Ends with `\n"`
2. Uses single quotes inside HTML attributes: `class='widget'` not `class="widget"`

```c
// ❌ WRONG
const char *html = "<!DOCTYPE html>"
    "<style>body { color: blue; }</style>";
    // ^ Missing terminating quote

// ✅ CORRECT
const char *html = "<!DOCTYPE html>\n"
    "<style>\n"
    "body { color: blue; }\n"
    "</style>\n";
```

---

### Issue: Undefined Reference to Component Functions

**Error:**
```
undefined reference to `dht11_read'
```

**Root Cause:**
Custom component (e.g., DHT11) not listed in `main/CMakeLists.txt` REQUIRES.

**Solution:**

```cmake
idf_component_register(
    SRCS "main.c"
    REQUIRES esp_http_server nvs_flash esp_wifi dht11  # Add custom component
)
```

---

### Issue: `example_connect` Failing

**Error:**
```
ESP_ERROR_CHECK failed: esp_err_t 0xffffffff (ESP_FAIL)
esp_err_to_name(E) returning NULL
abort() was called at PC 0x...
```

**Root Cause:**
WiFi credentials (SSID/password) are missing or incorrect in `sdkconfig`, or WiFi network is not available.

**Solution:**
1. Run `idf.py menuconfig`
2. Navigate: Example Connection Configuration → WiFi SSID & WiFi Password
3. Enter correct credentials
4. Save and rebuild: `idf.py build && idf.py flash`

Alternatively, if using `protocol_examples_common`, set environment variables before flashing:
```bash
export WIFI_SSID="MyNetwork"
export WIFI_PASSWORD="MyPassword"
idf.py build
```

---

## Runtime Issues

### Issue: Sensor Continuously Fails / Shows `Initializing` Forever

**Symptoms:**
- Dashboard shows "Initializing sensor" for >10 seconds
- `/api/data` returns `"initialized": false` repeatedly

**Root Cause:**
1. GPIO pin misconfigured or sensor not wired correctly
2. Sensor task never runs (high priority tasks blocking it)
3. Checksum/timing issues in sensor driver

**Debugging Steps:**

1. **Check GPIO Assignment:**
   ```c
   #define DHT11_PIN GPIO_NUM_26  // Verify this matches wiring
   ```

2. **Check Sensor Logs:**
   ```bash
   idf.py monitor
   # Look for: "Sensor read failed: ESP_ERR_TIMEOUT"
   ```

3. **Verify Wiring:**
   - Data pin connected to GPIO_NUM_26 (or your selected GPIO)
   - 10kΩ pull-up resistor on data line (to 3.3V)
   - GND and VCC connected

4. **Test GPIO in Isolation:**
   ```c
   // Temporarily add this to app_main():
   gpio_set_level(DHT11_PIN, 0);
   vTaskDelay(pdMS_TO_TICKS(100));
   ESP_LOGI(TAG, "GPIO low, level=%d", gpio_get_level(DHT11_PIN));
   gpio_set_level(DHT11_PIN, 1);
   vTaskDelay(pdMS_TO_TICKS(100));
   ESP_LOGI(TAG, "GPIO high, level=%d", gpio_get_level(DHT11_PIN));
   ```

---

### Issue: HTTP Server Not Responding / Port Already in Use

**Symptoms:**
- Can't reach `http://192.168.x.x/`
- Logs show `Error starting server!`

**Root Cause:**
1. Device didn't get IP address (WiFi not connected)
2. Another app already using port 80
3. HTTP server stopped after WiFi disconnect

**Debugging Steps:**

1. **Check WiFi Connection:**
   ```bash
   idf.py monitor
   # Look for: "Got IPv4 event: ip changed to: x.x.x.x"
   ```

2. **Verify Server Started:**
   ```bash
   # Should see: "Registering URI handlers"
   ```

3. **Check Firewall:**
   Ensure device and host are on same network subnet

4. **Restart Device:**
   Power cycle or remote shutdown

---

### Issue: High Memory Usage / Heap Fragmentation

**Symptoms:**
- Frequent heap allocation failures
- Sensor task dies after a few hours
- `heap_free` in logs keeps decreasing

**Root Cause:**
1. Memory leak in HTTP handler or sensor task
2. Large string allocations in JSON handler
3. WiFi buffers consuming heap

**Solution:**

```c
// In app_main(), periodically log heap:
static void monitor_heap(void *pvParameters)
{
    while (1) {
        ESP_LOGI(TAG, "Heap: free=%u, min=%u",
            esp_get_free_heap_size(),
            esp_get_minimum_free_heap_size());
        vTaskDelay(pdMS_TO_TICKS(10000));  // Every 10 seconds
    }
}

// Create this task:
xTaskCreate(monitor_heap, "monitor", 2048, NULL, 1, NULL);
```

If heap decreases monotonically, profile with:
```bash
idf.py partition-table
idf.py size
```

---

### Issue: Watchdog Timeout / Device Reboots

**Error:**
```
RTCWDT_RTC_RESET: RTC Watchdog Timer reset
```

**Root Cause:**
1. Sensor task or HTTP handler blocking for too long
2. Mutex deadlock
3. Infinite loop in initialization

**Solution:**

1. **Yield CPU regularly:**
   ```c
   // In long loops:
   vTaskDelay(pdMS_TO_TICKS(1));
   ```

2. **Use timeouts on mutexes:**
   ```c
   // Instead of portMAX_DELAY:
   if (xSemaphoreTake(sensor_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
       ESP_LOGW(TAG, "Mutex timeout");
       return;
   }
   ```

3. **Increase task stack if needed:**
   ```c
   xTaskCreate(sensor_task, "sensor", 3072, NULL, 5, NULL);  // Increased from 2048
   ```

---

### Issue: JSON Response Truncated or Malformed

**Symptoms:**
- Frontend JSON.parse() fails
- Response incomplete (e.g., `{"temp_c":25.1`)

**Root Cause:**
1. JSON buffer too small for snprintf output
2. `strlen()` called on partially-filled buffer

**Solution:**

```c
// Always check snprintf return value and buffer size:
char json[256];  // Large enough for your JSON

int len = snprintf(json, sizeof(json),
    "{\"temp_c\":%.1f,\"humidity\":%.1f,\"ts\":%" PRId64 "}",
    temp, humidity, timestamp);

if (len >= sizeof(json)) {
    ESP_LOGW(TAG, "JSON truncated: %d >= %u", len, sizeof(json));
    // Buffer too small, increase size
}

httpd_resp_send(req, json, len);
```

---

## Logging Best Practices

Enable all relevant log levels during debug:

```c
// In app_main():
esp_log_level_set("weather_station", ESP_LOG_DEBUG);
esp_log_level_set("dht11", ESP_LOG_DEBUG);
esp_log_level_set("esp_http_server", ESP_LOG_INFO);
```

Then monitor:
```bash
idf.py -p /dev/ttyUSB0 monitor
```

Filter by tag (in monitor terminal):
```
# Type 'V' to toggle verbose
# Type 'I' for INFO level
# Type 'W' for warnings only
```

