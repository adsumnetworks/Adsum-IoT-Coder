# Pattern: REST API Design for Hardware Data

## Overview
REST APIs for hardware data on ESP32 must use consistent JSON schemas with state flags, enabling frontends to distinguish startup, live data, and error conditions. This pattern applies to sensors, meters, status readouts, and any hardware that produces periodic data.

**Applicability:** Temperature/humidity/pressure sensors, ADC measurements, GPIO status, I2C/SPI device readings, motion detectors, light sensors, real-time metrics.

## Standard Responses

### 1. Successful Hardware Read (`200 OK`)

```json
{
  "value1": 25.3,
  "value2": 60.5,
  "timestamp_ms": 1712973564000,
  "valid": true,
  "initialized": true
}
```

**Interpretation:** Device has been read successfully. Frontend can display values.

**C Implementation (Template):**
```c
static esp_err_t handle_data(httpd_req_t *req)
{
    xSemaphoreTake(device_mutex, portMAX_DELAY);
    
    char json[256];
    snprintf(json, sizeof(json),
        "{\"value1\":%.2f,\"value2\":%.2f,\"timestamp_ms\":%" PRId64 ","
        "\"valid\":%s,\"initialized\":%s}",
        device_data.value1,
        device_data.value2,
        device_data.timestamp_ms,
        device_data.valid ? "true" : "false",
        device_data.initialized ? "true" : "false");
    
    xSemaphoreGive(device_mutex);
    
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, json, strlen(json));
    return ESP_OK;
}
```

### 2. Device Not Yet Read (`200 OK`, `initialized=false`)

```json
{
  "value1": null,
  "value2": null,
  "timestamp_ms": 0,
  "valid": false,
  "initialized": false
}
```

**Interpretation:** Device powered or HTTP server started, but task hasn't yet performed first read. Frontend should show loading/initializing UI.

### 3. Hardware Read Error (`200 OK`, `valid=false`, `initialized=true`)

```json
{
  "value1": null,
  "value2": null,
  "timestamp_ms": 1712973564000,
  "valid": false,
  "initialized": true
}
```

**Interpretation:** Device was working, but last N read attempts failed (timeout, checksum, GPIO error, I2C NAK). Frontend should display error/disconnected status. Timestamp shows when error was detected.

### 4. Device Not Connected / WiFi Down (`504 Service Unavailable` or Fetch Error)

Frontend receives network error from `fetch()`. No JSON body needed for HTTP errors.

## JSON Schema Reference (Template)

```c
// Generic hardware data response — adapt value field names to your device
typedef struct {
    float value1;           // Primary measurement (temperature, light level, distance)
    float value2;           // Secondary measurement (humidity, pressure, etc.)
    int64_t timestamp_ms;   // When measurement was obtained (via esp_timer_get_time() / 1000)
    bool valid;             // Data is fresh and passed validation checks
    bool initialized;       // At least one read attempt was made on startup
} hardware_reading_t;
```

**Key Semantics:**
- `valid=true, initialized=true`: Device is working, displaying live data ✓ Show values
- `valid=false, initialized=false`: Device just started, no read yet ⏳ Show "Loading..."
- `valid=false, initialized=true`: Device had errors after working ✗ Show "Device Error"
- Frontend never receives response: WiFi/HTTP down 🌐 Show "Not Connected"

## Endpoint Reference (Template)

| Endpoint | Method | Purpose | Response |
|----------|--------|---------|----------|
| `/` | GET | Serve HTML dashboard | HTML page (text/html) |
| `/api/data` | GET | Return latest device reading | JSON {value1, value2, timestamp_ms, valid, initialized} |
| `/api/config` | GET | Optional: Return device config | JSON with settings, firmware version, uptime |
| `/api/reset` | POST | Optional: Reset error counters | {\"status\": \"ok\"} |

**Naming Conventions:**
- Primary data endpoint: `/api/data` or `/api/reading` (keep it short, no domain prefix)
- Device specific: `/api/sensor`, `/api/meter`, `/api/device` (optional, use `/api/data` unless multiple device types)
- Device info: `/api/info` or `/api/config` for metadata

## Frontend Integration

### JavaScript Fetch and Display

```javascript
async function updateSensorDisplay() {
  try {
    const response = await fetch('/api/data');
    const data = await response.json();
    
    // Render based on state
    if (!data.initialized) {
      displayStatus('Initializing', 'warn');
      displayValue('--', '--');
    } else if (data.valid) {
      displayStatus('Online', 'ok');
      displayValue(data.temp_c.toFixed(1), data.humidity.toFixed(1));
    } else {
      displayStatus('Sensor Error', 'error');
      displayValue('--', '--');
    }
    
    updateTimestamp(data.timestamp_ms);
  } catch (err) {
    displayStatus('Network Error', 'error');
    console.error('API fetch failed:', err);
  }
}

function updateTimestamp(ms) {
  if (!ms) {
    document.getElementById('last-update').textContent = 'Never';
    return;
  }
  const date = new Date(ms);
  const time = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  document.getElementById('last-update').textContent = time;
}

// Poll every 3 seconds
setInterval(updateSensorDisplay, 3000);
updateSensorDisplay();
```

## Multi-Sensor Response (Extended)

For projects with multiple sensors, nest readings:

```json
{
  "sensors": {
    "temperature": {
      "value": 25.3,
      "unit": "°C",
      "valid": true,
      "timestamp_ms": 1712973564000
    },
    "humidity": {
      "value": 60.5,
      "unit": "%",
      "valid": true,
      "timestamp_ms": 1712973564000
    }
  },
  "device": {
    "uptime_ms": 3600000,
    "heap_free": 45000
  }
}
```

## HTTP Status Codes

| Code | Scenario | Response |
|------|----------|----------|
| 200 OK | Sensor data available (valid or not) | JSON with status fields |
| 404 Not Found | Invalid endpoint | Minimal body or none |
| 500 Internal Server Error | Crash or undefined state | None (avoid exposing stack) |
| 503 Service Unavailable | WiFi down, HTTP server stopped | None |

## Memory-Efficient Encoding

For constrained devices, limit JSON size:

```c
// Use fixed-point math instead of floats for transmission if needed
// temp_c = 25.3 → send as integer 253, divide by 10 on client
snprintf(json, sizeof(json),
    "{\"temp_x10\":%d,\"humidity_x10\":%d,\"ts\":%" PRId64 ",\"ok\":%s}",
    (int)(sensor_data.temp_c * 10),
    (int)(sensor_data.humidity * 10),
    sensor_data.timestamp_ms,
    sensor_data.valid ? "1" : "0");
```

## Error Handling in Handlers

```c
static esp_err_t handle_data(httpd_req_t *req)
{
    // Always check mutex acquisition
    if (xSemaphoreTake(data_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        httpd_resp_sendstr(req, "{\"error\":\"Busy\"}");
        return ESP_FAIL;
    }
    
    // Get data
    char json[256];
    snprintf(json, ...);
    
    xSemaphoreGive(data_mutex);
    
    // Set correct content type
    httpd_resp_set_type(req, "application/json; charset=utf-8");
    
    // Send with length
    return httpd_resp_send(req, json, strlen(json));
}
```

## CORS (if needed for external clients)

Add HTTP headers for cross-origin access:

```c
httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, OPTIONS");
```

## Reference: PRId64 Macro

For `int64_t` timestamp serialization, always use `PRId64` (defined in `<inttypes.h>`):

```c
#include <inttypes.h>  // Must include

int64_t timestamp = esp_timer_get_time() / 1000;
snprintf(json, sizeof(json), "\"ts\":%" PRId64, timestamp);
// Output: "ts":1712973564000
```

