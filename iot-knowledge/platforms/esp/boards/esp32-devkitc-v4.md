# Hardware constraint: ESP32 DevKitC v4 (boards/esp32-devkitc-v4.md)

## Board Overview
The ESP32-DevKitC v4 is one of Espressif's primary development boards featuring the ESP32-WROOM-32 module.

- **Target Name:** `esp32` (This is the argument for `idf.py set-target`)
- **Core:** Dual-Core Xtensa 32-bit LX6
- **Architecture:** 32-bit

## Key Constraints

### 1. Memory Profile
- **SRAM:** ~520 KB internal. (Usable by application is usually around 300KB due to Wi-Fi/BT stack overhead).
- **Flash:** 4 MB SPI Flash (typically).
- **Strategy:** You must be mindful of memory. Heavy JSON documents or huge HTML strings must be stored in Flash (`const char * PROGMEM`) rather than allocated dynamically in RAM.

### 2. Wi-Fi & Bluetooth Restrictions
While the ESP32 supports both Wi-Fi and Bluetooth (Classic / BLE), running both simultaneously consumes an enormous amount of RAM (often > 150KB). Ensure `menuconfig` is tuned carefully or avoid running both unless strictly necessary.

### 3. I/O Restrictions
- **Pins 34-39:** Input ONLY. Do not use for PWM, I2C, or SPI MOSI. They do not have internal pull-up/pull-down resistors.
- **Strapping Pins (0, 2, 5, 12, 15):** Used to determine the boot mode (flashing vs execution). Avoid using these for output during boot, or the device may fail to start. Pin 2 is typically the onboard blue LED.
- **Flash Pins (6-11):** Do NOT use. These are connected directly to the integrated SPI flash.

### 4. Hardware Timers
Features 4 hardware timers (2 groups of 2).

### 5. Flashing and UART
- The DevKitC features an onboard USB-to-UART bridge (CP2102 or CH340).
- Flashing typically requires no manual button pressing (Auto-program circuit using DTR/RTS).
- **Default Monitor Baud Rate:** 115200.
