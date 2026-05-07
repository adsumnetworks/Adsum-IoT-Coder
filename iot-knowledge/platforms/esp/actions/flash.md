# Action: Flash Firmware (actions/flash.md)

## When Used
Called from: Debug Loop, or whenever the user instructs to flash the device.

## Pre-conditions
- Build succeeded (`idf.py build` completed without errors).
- The ESP device is connected via USB.

## Device Port Discovery (First-Flash Protocol)

Before flashing, you must find the serial port the ESP32 is attached to.
Typically, on Linux, this is `/dev/ttyUSB0` or `/dev/ttyACM0`.

**To auto-detect and flash:**
In most cases, ESP-IDF can auto-detect the port natively. Try this first:
```bash
. /home/omar/esp/v5.5.2/esp-idf/export.sh && idf.py flash
```

**If auto-detection fails or there are multiple devices:**
1. List available serial ports:
   ```bash
   python -m serial.tools.list_ports
   ```
2. Ask the user which port corresponds to the target device.
3. Pass the port explicitly:
   ```bash
   . /home/omar/esp/v5.5.2/esp-idf/export.sh && idf.py -p <port> flash
   ```

## Execution Details
- Flashing will write the bootloader, partition table, and the application binary.
- Do not interrupt the flash process.
- If flashing fails with "Permission denied: '/dev/ttyUSB0'", advise the user they need `dialout` group permissions or `sudo chmod a+rw /dev/ttyUSB0` (Linux typically).
- If flashing fails to connect/sync, advise the user to hold the `BOOT` button on their board when the "Connecting..." prompt begins.
