# Pattern: Creating Custom ESP-IDF Components (Hardware Drivers)

## Overview
Reusable hardware drivers for ESP32 (sensors, modules, protocol stacks) should be packaged as ESP-IDF components for portability, testability, and clean incorporation into other projects. This pattern shows the minimal structure for any custom component.

**Applicability:** DHT11 temperature sensors, BME680 environmental sensors, display drivers, motor controllers, communication modules (LoRa, NB-IoT), any hardware-specific code.

## Directory Structure (Template)

```
components/
└── my_hardware_driver/         ← RENAME: component name must match folder
    ├── CMakeLists.txt          ← ESP-IDF build registration
    ├── idf_component.yml       ← Metadata (optional but recommended)
    ├── include/
    │   └── my_hardware_driver.h    ← Public API (users #include this)
    └── my_hardware_driver.c        ← Implementation (private, unless needed)
```

**Key Rule:** Component folder name **must** match the `COMPONENT_NAME` in CMakeLists.txt. It's also the name users will add to their project's dependencies.

## Step 1: Public Header (`include/my_hardware_driver.h`)

```c
#pragma once

#include <esp_err.h>
#include <driver/gpio.h>

/**
 * @brief Initialize hardware device
 * @param pin GPIO pin (or I2C address, SPI chip select, etc. — adapt to your device)
 * @return 
 *   - ESP_OK: Initialization succeeded
 *   - ESP_ERR_INVALID_ARG: Invalid parameter
 *   - ESP_FAIL: Hardware not responding
 */
esp_err_t my_hardware_init(gpio_num_t pin);

/**
 * @brief Read device and return measurement(s)
 * @param pin GPIO pin for device (or handle, depending on device type)
 * @param value1 Pointer to store primary measurement (float, int, or custom struct)
 * @param value2 Pointer to store secondary measurement (or leave NULL)
 * @return
 *   - ESP_OK: Read successful
 *   - ESP_ERR_TIMEOUT: Device not responding or communication timeout
 *   - ESP_ERR_INVALID_CRC: Data validation failed
 *   - ESP_FAIL: Other error
 */
esp_err_t my_hardware_read(gpio_num_t pin, float *value1, float *value2);

/**
 * @brief Clean up resources (optional for simple devices)
 */
void my_hardware_deinit(void);
```

## Step 2: CMakeLists.txt (Component Registration)

```cmake
idf_component_register(
    SRCS "my_hardware_driver.c"    # Implementation files
    INCLUDE_DIRS "include"         # Public header directory
    PRIV_REQUIRES "driver"         # Private dependencies (GPIO, I2C, SPI, etc.)
)
```

**Key Directives:**
- `SRCS`: Your `.c` implementation files
- `INCLUDE_DIRS`: Public header directory (what users can #include)
- `PRIV_REQUIRES`: Dependencies used internally (not exposed to users)
- `REQUIRES`: Dependencies exposed in public headers (rarely needed for simple drivers)

**Common Private Dependencies:**
- `driver`: GPIO, I2C, SPI, ADC, UART, timers
- `esp_rom`: ROM functions (delay, CRC, hardware access)
- `hal`: Hardware abstraction layer types
- `freertos`: For task/mutex operations

**Example for I2C device:**
```cmake
idf_component_register(
    SRCS "bmp280.c"
    INCLUDE_DIRS "include"
    PRIV_REQUIRES "driver esp_rom"
)
```

## Step 3: Implementation (`my_hardware_driver.c`)

**Key Patterns:**
- Protocol-specific timing (bit-banging, I2C, SPI — adapt as needed)
- Timeout protection to prevent infinite loops
- Data validation/checksum (CRC-8, parity bits, range checks)
- Logging with `ESP_LOG*` macros for debugging
- Error codes matching ESP-IDF conventions

```c
#include <esp_log.h>
#include <esp_err.h>
#include <driver/gpio.h>
#include <esp_rom_delay.h>

#define DEVICE_TIMEOUT_US 1000       // Adjust per your hardware timing
#define DEVICE_TAG "my_hardware"

esp_err_t my_hardware_init(gpio_num_t pin)
{
    // Configure GPIO or peripheral for your device
    gpio_config_t cfg = {
        .pin_bit_mask = (1ULL << pin),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    ESP_RETURN_ON_ERROR(gpio_config(&cfg), DEVICE_TAG, "GPIO config failed");
    
    // Device-specific initialization (soft reset, mode config, etc.)
    gpio_set_level(pin, 1);
    esp_rom_delay_us(100);
    
    ESP_LOGI(DEVICE_TAG, "Device initialized on GPIO %d", pin);
    return ESP_OK;
}

esp_err_t my_hardware_read(gpio_num_t pin, float *value1, float *value2)
{
    ESP_ARG_CHECK(value1 != NULL);  // Validate pointers
    
    // Step 1: Trigger measurement (device-specific protocol)
    gpio_set_level(pin, 1);
    esp_rom_delay_us(100);
    gpio_set_level(pin, 0);         // Start pulse
    
    // Step 2: Read response with timeout to prevent hang
    int timeout = DEVICE_TIMEOUT_US;
    uint32_t raw_data = 0;
    
    while (timeout-- > 0) {
        if (gpio_get_level(pin) == 1) {  // Look for data ready signal
            raw_data = gpio_get_level(pin);
            break;
        }
        esp_rom_delay_us(1);
    }
    
    if (timeout <= 0) {
        ESP_LOGW(DEVICE_TAG, "Read timeout after %d us", DEVICE_TIMEOUT_US);
        return ESP_ERR_TIMEOUT;
    }
    
    // Step 3: Validate data (range checks, CRC, parity, etc.)
    if (raw_data == 0 || raw_data > 4095) {  // Example: 12-bit ADC range
        ESP_LOGE(DEVICE_TAG, "Invalid data read: %lu", raw_data);
        return ESP_ERR_INVALID_CRC;
    }
    
    // Step 4: Convert to user-friendly units
    *value1 = (float)raw_data * 0.001f;  // Example: raw ADC to voltage
    if (value2) *value2 = 0.0;           // Optional second reading
    
    ESP_LOGI(DEVICE_TAG, "Read OK: raw=%lu, value1=%.3f", raw_data, *value1);
    return ESP_OK;
}

void my_hardware_deinit(void)
{
    // Clean up GPIO and peripheral resources
    gpio_reset_pin(GPIO_NUM_0);  // Reset to default state
    ESP_LOGI(DEVICE_TAG, "Device deinitialized");
}
``` 
                         byte_idx, bit_idx);
                return ESP_ERR_TIMEOUT;
            }
            
            // Measure pulse width (high time)
            int pulse_width = 0;
            timeout = DHT11_TIMEOUT_US;
            while (gpio_get_level(pin) == 1 && timeout--) {
                pulse_width++;
                esp_rom_delay_us(1);
            }
            
            // Pulse width > 50us → bit is 1, else 0
            data[byte_idx] = (data[byte_idx] << 1) | (pulse_width > 50 ? 1 : 0);
        }
    }
    
    // Step 5: Validate checksum (byte 4 = XOR of bytes 0-3)
    uint8_t checksum = data[0] ^ data[1] ^ data[2] ^ data[3];
    if (checksum != data[4]) {
        ESP_LOGW(TAG, "CRC mismatch: calculated 0x%02x, received 0x%02x", 
                 checksum, data[4]);
        return ESP_ERR_INVALID_CRC;
    }
    
    // Step 6: Parse and return values
    *humidity = (float)data[0];      // Integer humidity
    *temp_c = (float)data[2];        // Integer temperature
    
    ESP_LOGD(TAG, "Read: temp=%d°C, humidity=%d%%", data[2], data[0]);
    return ESP_OK;
}
```

## Step 3: Register Component (`CMakeLists.txt`)

```cmake
idf_component_register(
    SRCS "dht11.c"
    INCLUDE_DIRS "include"
    PRIV_REQUIRES driver
)
```

**Explanation:**
- `SRCS`: Source files to compile
- `INCLUDE_DIRS`: Public header directory (accessible to projects that require this component)
- `PRIV_REQUIRES`: Dependencies used only internally (driver = GPIO functions)
- If needed by multiple components, use `REQUIRES` instead

## Step 4: Component Metadata (`idf_component.yml`) *(Optional but recommended)*

```yaml
version: "0.1"
description: DHT11 Temperature & Humidity Sensor Driver
url: https://github.com/yourname/esp32-dht11
require:
  idf: ">=5.5"
dependencies:
  driver: "*"
```

## Integration in Main Project

### `main/CMakeLists.txt`

```cmake
set(requires esp_http_server nvs_flash esp_wifi)
idf_component_register(
    SRCS "main.c"
    REQUIRES ${requires} dht11
)
```

### `main/main.c`

```c
#include "dht11.h"

// Usage in task:
esp_err_t err = dht11_read(GPIO_NUM_26, &temperature, &humidity);
```

## Best Practices

1. **Namespace Headers:** Use component name prefix (`#include "dht11.h"`)
2. **Error Returns:** Always return ESP-IDF error codes for consistency
3. **Private Headers:** Use `include/` for public, keep private headers outside
4. **Logging Levels:** Use `ESP_LOGI` for startup, `ESP_LOGD` for runtime, `ESP_LOGE` for errors
5. **Documentation:** Add Doxygen-style comments to public functions

## Reusing the Component

Once created, any ESP32 project can add the component:

```bash
# Copy or symlink into your project
cp -r <path-to-dht11> <your_project>/components/

# Or reference externally in CMakeLists.txt
set(EXTRA_COMPONENT_DIRS "/path/to/components")
```

Then require it in `main/CMakeLists.txt`, and it will be found automatically.

