# Pattern: Periodic Hardware Reading Task with State Machine

## Overview
Reading hardware devices (sensors, ADC, I2C, SPI) on ESP32 via FreeRTOS tasks requires careful state management, thread-safe data sharing via mutexes, and resilient error handling. This pattern establishes standard task structure, initialization sequences, and state transitions that work for **any** hardware type (sensors, modules, GPIO devices, etc.).

**Applicability:** DHT11 temperature sensors, BME680 pressure sensors, light sensors, motion detectors, rotary encoders, analog joysticks, or any periodic hardware read.

## State Transitions

```
┌─────────────────┐
│  UNINITIALIZED  │ (startup: no reads yet)
└────────┬────────┘
         │ (first successful read)
         ▼
┌─────────────────┐
│   INITIALIZED   │◄──┐  (consecutive_failures < 3)
│   & VALID DATA  │   │  (successful read resets counter)
└────────┬────────┘   │
         │            │
         │ (3+ consecutive failures)
         ▼
┌─────────────────┐───┘
│ ERROR/RETRYING  │
│  (invalid data) │
└─────────────────┘
```

## Core Data Structure (Template)

```c
typedef struct {
    // Hardware reading(s) — adapt to your device
    float value1;           // e.g., temperature, light level, pressure
    float value2;           // e.g., humidity, distance, secondary reading
    int raw_adc;            // Optional: raw ADC counts
    
    // Metadata (REQUIRED for all hardware types)
    int64_t timestamp_ms;   // When obtained (via esp_timer_get_time() / 1000)
    bool valid;             // Last read succeeded and passed validation
    bool initialized;       // At least one read attempt made
} device_data_t;

static device_data_t device_data;
static SemaphoreHandle_t device_mutex;
```

**Rules:**
- Always include `timestamp_ms`, `valid`, `initialized` for frontend state understanding
- Adapt field names to hardware (e.g., temp_c, light_lux, distance_cm, pressure_pa)
- Use appropriate types (float for continuous, int for discrete/raw values)

## Task Implementation

### 1. Initialization (in `app_main()`)

```c
// Initialize struct with safe defaults
device_data.value1 = 0;
device_data.value2 = 0;
device_data.raw_adc = 0;
device_data.timestamp_ms = 0;
device_data.valid = false;           // No valid data yet
device_data.initialized = false;     // No read attempt yet

// Create mutex for thread-safe access (CRITICAL for HTTP handlers)
device_mutex = xSemaphoreCreateMutex();
if (device_mutex == NULL) {
    ESP_LOGE(TAG, "Failed to create device mutex");
    return ESP_FAIL;
}

// Spawn reading task (priority 5 suitable for background I/O)
xTaskCreate(device_read_task, "device_task", 2048, NULL, 5, NULL);
```

### 2. Task Loop

```c
static void sensor_task(void *pvParameters)
{
    int consecutive_failures = 0;
    const int FAILURE_THRESHOLD = 3;  // Mark as error after 3 failures
    const int READ_INTERVAL_MS = 2000; // Read every 2 seconds
    
    while (1) {
        // Read hardware (blocking operation)
        float temp, humidity;
        esp_err_t err = dht11_read(DHT11_PIN, &temp, &humidity);
        
        // Critical section: update shared state
        xSemaphoreTake(sensor_mutex, portMAX_DELAY);
        sensor_data.timestamp_ms = esp_timer_get_time() / 1000;
        
        if (err == ESP_OK) {
            sensor_data.temp_c = temp;
            sensor_data.humidity = humidity;
            sensor_data.valid = true;
            sensor_data.initialized = true;
            consecutive_failures = 0;
            ESP_LOGI(TAG, "Sensor: temp=%.1f°C, humidity=%.1f%%", temp, humidity);
        } else {
            ESP_LOGW(TAG, "Sensor read failed: %s", esp_err_to_name(err));
            consecutive_failures++;
            
            // Transition to ERROR state after threshold
            if (consecutive_failures >= FAILURE_THRESHOLD) {
                sensor_data.valid = false;
                sensor_data.initialized = true;
            }
        }
        xSemaphoreGive(sensor_mutex);
        
        // Sleep before next read
        vTaskDelay(pdMS_TO_TICKS(READ_INTERVAL_MS));
    }
}
```

## HTTP API Integration

### JSON Response (from `/api/data` endpoint)

```c
static esp_err_t data_get_handler(httpd_req_t *req)
{
    xSemaphoreTake(sensor_mutex, portMAX_DELAY);
    char json[192];
    
    if (sensor_data.valid) {
        snprintf(json, sizeof(json), 
            "{\"temp_c\":%.1f,\"humidity\":%.1f,\"timestamp_ms\":%" PRId64 ","
            "\"valid\":true,\"initialized\":true}",
            sensor_data.temp_c, sensor_data.humidity, sensor_data.timestamp_ms);
    } else {
        snprintf(json, sizeof(json),
            "{\"temp_c\":null,\"humidity\":null,\"timestamp_ms\":%" PRId64 ","
            "\"valid\":false,\"initialized\":%s}",
            sensor_data.timestamp_ms,
            sensor_data.initialized ? "true" : "false");
    }
    xSemaphoreGive(sensor_mutex);
    
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, json, strlen(json));
    return ESP_OK;
}
```

## Frontend Status Display Logic

```javascript
function updateSensorStatus(data) {
    if (!data.initialized) {
        // Waiting for first read
        statusElement.textContent = "Initializing sensor";
        statusElement.className = "status-warn";
    } else if (data.valid) {
        // Data is fresh and valid
        statusElement.textContent = "Sensor online";
        statusElement.className = "status-online";
    } else {
        // Initialized but consecutive failures
        statusElement.textContent = "Sensor unavailable";
        statusElement.className = "status-error";
    }
}
```

## Best Practices

1. **Consecutive Failure Counter:** Reset to 0 on success. Prevents flapping between valid/error.
2. **Timestamp Always Updated:** Even on failure, update `timestamp_ms` so UI can show "last attempt time".
3. **Mutex Coverage:** Minimize critical section — mutexes should protect only the struct access, not hardware reads.
4. **Task Priority:** Use priority 5 (default) for sensor tasks. Avoid blocking in HTTP handlers.
5. **Stack Size:** DHT11 bit-banging or other GPIO sensing requires ~2048 bytes minimum.

## Error Handling Reference

See `troubleshooting/sensor-failures.md` for common sensor read failures (GPIO config, pull-up issues, timing).
