# Add Feature Workflow (workflows/add-feature.md)

**Triggered by:** Task text contains `add a feature` or `Add a feature to`. Also loaded by
`prototype.md` (once per capability) to port an example into a fresh scaffold.

Adds **one** well-scoped feature to an **existing** ESP-IDF project (Scope Gate applies — a
`CMakeLists.txt` referencing IDF + a `main/` component).

---

## Step 1: Confirm scope gate
Run the Scope Gate check. If no valid project, do NOT proceed — follow `AGENT.md`.

---

## Step 2: Identify the feature
Use `ask_followup_question` if unclear:
> "Which feature? e.g. a console command (REPL), a Wi-Fi service, an HTTP/web endpoint, NVS storage,
> an I²C sensor, MQTT, or 'port X from IDF example Y'."

---

## Step 3: Locate the source example or component
**MANDATORY SKILL LOAD:** `read_file` → `platforms/esp/actions/find-sample.md` and follow it to find
the IDF example (or registry component) that implements the feature. Confirm the path exists with
`list_files` before copying anything.

---

## Step 4: Read the project, then apply the port
Read first (do **not** modify yet): the project's `main/CMakeLists.txt`, `main/main.c`,
`sdkconfig` / `sdkconfig.defaults`, and the **source example's** `main/`, `CMakeLists.txt`, and
`sdkconfig.defaults`.

Apply only the layers the feature needs:
1. **C code** → a new `main/<name>.c` (or a `components/<name>/` for a reusable driver); call its init
   from `app_main()`. Prefer a small init + its own FreeRTOS task over piling logic into `app_main`.
2. **CMake** → add the new source to `SRCS` and any new component to `REQUIRES` / `PRIV_REQUIRES` in
   `main/CMakeLists.txt` (e.g. `esp_wifi`, `esp_http_server`, `nvs_flash`, `driver`, `mqtt`).
3. **Managed dependency** (registry component) → `idf.py add-dependency "namespace/name"` (writes
   `main/idf_component.yml`); the next build downloads it.
4. **Kconfig** → only if the feature needs it (`actions/configure.md` for the `sdkconfig` vs
   `sdkconfig.defaults` rule). Don't add unrelated config.

Show a diff-style summary before writing.

---

## Curated recipe: external I²C sensor (the case the agent struggles with)
An off-board I²C sensor (BME280, SHT4x, …) is **config-first**: wrong bus/GPIO/address is the #1 reason
"the sensor doesn't read." Ground the exact calls from the IDF `examples/peripherals/i2c/i2c_simple`
read loop via `find-sample.md` — never invent register sequences.

1. **Pick the bus + GPIOs (don't guess).** ESP-IDF v5 uses the `driver/i2c_master.h` API — create an
   `i2c_master_bus` on a chosen `I2C_NUM` with the board's actual **SDA/SCL GPIOs**, then add the
   device by its 7-bit address. Confirm the GPIOs from the board pinout (`boards/<chip>.md`), not a guess.
2. **Address is 7-bit.** BME280 = `0x76` (SDO→GND) or `0x77` (SDO→VDD). If a datasheet lists 8-bit
   read/write addresses, use only the top 7 bits.
3. **Pull-ups.** I²C needs pull-ups on SDA/SCL — most dev boards/breakouts have them; if reads time
   out, suspect missing pull-ups before code.
4. **Verify first:** read the chip-ID register as a sanity check before trusting data; log the raw bytes.

---

## Curated recipe: Wi-Fi service + web dashboard (folded ESP idioms)
For "serve a page / live sensor dashboard", compose three pieces. Base = `examples/wifi/getting_started/station`
+ `examples/protocols/http_server/simple` (via find-sample). Wi-Fi init order, the HTTP server, and the
**chunked send** for large pages live in `sdks/esp-idf/protocols/WIFI.md` — read it. Then add:

1. **Embedded HTML (no filesystem).** Bake the page into firmware as a C raw string in its own header —
   foolproof, no SPIFFS/LittleFS to mount:
   ```c
   // webpage.h
   #pragma once
   const char index_html[] = R"=====(
   <!DOCTYPE html><html><body><h1 id="t">-- °C</h1>
   <script>setInterval(()=>fetch('/api/data').then(r=>r.json())
     .then(d=>document.getElementById('t').innerText=d.temp_c+' °C'),2000);</script>
   </body></html>
   )=====";
   ```
   Vanilla JS/CSS only (no CDNs — a SoftAP board has no internet). Serve `/` with `index_html`; if it
   exceeds the HTTPD limit, stream it with `httpd_resp_send_chunk` (see WIFI.md).
2. **A reading task + thread-safe state** (any periodic hardware read). One task updates a shared
   struct under a mutex; the HTTP handler reads it under the same mutex:
   ```c
   typedef struct { float temp_c; int64_t ts_ms; bool valid, initialized; } sensor_state_t;
   static sensor_state_t g_state; static SemaphoreHandle_t g_mutex;  // xSemaphoreCreateMutex() in app_main
   // task: read sensor → xSemaphoreTake → update g_state (+ts, +valid) → xSemaphoreGive → vTaskDelay
   ```
   Track `valid` / `initialized` + a consecutive-failure count so the UI can show "initializing" vs
   "online" vs "unavailable". Keep the mutex section tiny (struct copy only, not the hardware read).
3. **A lightweight JSON endpoint** `/api/data` — take the mutex, `snprintf` the struct to JSON,
   `httpd_resp_set_type(req,"application/json")`, send. The page polls it with `fetch`; never reload
   the whole page for data.

Stack/heap notes: a GPIO-bit-banged sensor task needs ~2–4 KB stack; large buffers belong on the heap
or PSRAM (`MALLOC_CAP_SPIRAM`), not the task stack.

---

## Step 5: Verify the feature through the FULL Debug Loop (not just build+flash)
A feature is **proven** only by a captured log showing it running — never by a successful flash.
> "Feature applied. Want me to build, flash, and watch the logs to confirm it actually works?"

- **MANDATORY SKILL LOAD:** if yes, `read_file` → `platforms/esp/workflows/debug-loop.md` and run the
  **whole** loop: Build → Flash → **Capture → Analyze** (each phase loads its Action per the Command
  Gate). Stopping after flash is an unfinished verification. A Kconfig change → rebuild
  (`actions/configure.md`).
- **Know what "working" looks like before you capture:** from the code you added, note the `ESP_LOGI`
  lines that mark success (a sensor reading, `Got IP`, `httpd: starting server`). In Analyze, check the
  log for them — if absent or a panic appears, that's a failed verification: propose the fix and loop.
- Once the log confirms it: *"Want to add another feature on top?"* (loop here).
