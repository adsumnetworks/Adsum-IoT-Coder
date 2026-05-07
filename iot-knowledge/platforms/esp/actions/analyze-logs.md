# Action: Analyze Logs (actions/analyze-logs.md)

## When Used
Called after `capture-logs.md` has successfully dumped serial output to a `.log` file, or when a user pastes a crash dump.

## ESP-IDF Log Structure
ESP-IDF logs have a standard format:
`I (1234) TAG: Message string`
Where `I` is the severity level (E=Error, W=Warning, I=Info, D=Debug, V=Verbose), `(1234)` is the timestamp in milliseconds since boot, and `TAG` is the module identifier.

## Common Analysis Patterns

### 1. Guru Meditation Error (Core Panic)
If you see `Guru Meditation Error: Core X panic'ed`, the ESP32 has crashed.
- Look directly beneath the error for the **Backtrace**.
- `idf.py monitor` automatically decodes the PC (Program Counter) addresses into function names and line numbers if it has access to the `.elf` file.
- Look for the first function in the user's application code (ignore `vPortTaskWrapper` or underlying RTOS functions; trace up the stack to find the exact line causing the crash).

### 2. Task Watchdog Timeout (TWDT)
Error: `Task watchdog got triggered. The following tasks did not reset the watchdog in time:`
- Indicates a task is starving the CPU.
- Usually caused by a `while(1)` loop missing a `vTaskDelay` or `vTaskDelayUntil`.
- **Solution:** Add `vTaskDelay(pdMS_TO_TICKS(10));` to the offending loop so other tasks can run.

### 3. Stack Overflow
Error: `Stack smashing protect failure!` or `FreeRTOS: Stack overflow in task <TaskName>`
- **Cause:** Local variables inside the task consumed all allocated stack memory. (E.g., declaring large arrays `char buffer[4096]` on the stack instead of using heap `malloc`).
- **Solution:** Increase the task stack size in `xTaskCreate` or move large variables to the heap.

### 4. Memory Leaks (Wi-Fi/HTTP)
Error: `wifi: malloc failed` or `httpd: unable to allocate memory`
- **Cause:** Not freeing HTTP request buffers, or rapidly opening/closing connections without `free()`.
- **Solution:** Review buffer lifecycle in HTTP handlers. Ensure `cJSON_Delete` is called if using cJSON. Use `esp_get_free_heap_size()` to log heap health over time.
