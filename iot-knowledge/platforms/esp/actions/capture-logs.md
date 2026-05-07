# Action: Capture Logs (actions/capture-logs.md)

## When Used
Used to view UART serial logs coming from the ESP32 to diagnose application logic, Wi-Fi connections, crashes, and core panics.

## The Problem with `idf.py monitor`
Running `idf.py monitor` takes over the active terminal. Because you are an AI agent, if you run it synchronously, it will freeze your terminal session indefinitely and you will be unable to escape it using standard keyboard shortcuts (`Ctrl+]`).

## Background Capture Protocol (MANDATORY)

You must ALWAYS run the monitor in the background and pipe its output to a `.log` file, just like you do in the nRF platform.

### Step 1: Execute the background task
```bash
mkdir -p logs/uart
. /home/omar/esp/v5.5.2/esp-idf/export.sh && idf.py monitor > logs/uart/esp32_monitor_$(date +%s).log 2>&1 &
```
*Note: If you know the specific port, append `-p <port>` before `monitor`.*

### Step 2: Wait for data accretion
Wait roughly 5 to 10 seconds for the device to boot, initialize Wi-Fi, and print its logs.

### Step 3: Stop the monitor
To stop capturing, you must kill the background `idf.py` process.
```bash
killall -9 idf.py
# If that fails, find the PID via `jobs -l` or `ps aux | grep idf.py` and kill it.
```

### Step 4: Examine the output
Use your file viewing tools to open and read the generated `.log` file in `logs/uart/`.
Look for `app_main` entry, Wi-Fi IP address acquisition, or any `Guru Meditation Error` (Crash). (See `analyze-logs.md`).
