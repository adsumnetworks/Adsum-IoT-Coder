# ESP32 — Platform Index (`platforms/esp/`)

This file is the master index for the `platforms/esp/` directory. It describes everything available for Espressif ESP32 development (targeting **ESP-IDF v5.5**) and tells the agent when and how to load each resource.

---

## Directory Map

```text
platforms/esp/
├── PLATFORM.md              ← You are here. Master index for the ESP platform.
├── rules/
│   ├── esp-terminal.md      ← CRITICAL: Env routing rules (when to read: always)
│   └── skill-loading.md     ← Skill discovery & loading rules (when to read: always)
├── boards/
│   └── esp32-devkitc-v4.md  ← ESP32 DevKitC v4 hardware specs & constraints
├── sdks/
│   └── esp-idf/
│       ├── SDK.md           ← ESP-IDF structure, idf.py usage, CMake
│       └── protocols/
│           └── WIFI.md      ← Wi-Fi STA/AP, HTTP(D) Webserver practices
├── patterns/                ← Established design patterns (load as needed)
│   ├── sensor-task-pattern.md         ← FreeRTOS task for sensor reading & state machine
│   ├── component-development.md       ← How to create custom ESP-IDF components
│   ├── embedded-html-pattern.md       ← HTML/CSS/JS in C strings (quote escaping)
│   └── http-api-design.md            ← REST API schema, JSON responses for sensors
├── actions/                 ← Internal subroutines (load ONLY when a Workflow instructs)
│   ├── build.md             
│   ├── flash.md             
│   ├── capture-logs.md      
│   ├── analyze-logs.md      
│   └── web-dashboard-dev.md ← Frontend development best practices for ESP
├── troubleshooting/         ← Common issues and solutions (load as needed)
│   └── build-and-runtime.md ← undefined reference, quote errors, sensor init, watchdog
└── workflows/               ← Primary entry points (START HERE for each task)
    ├── iot-app-generator.md ← Pattern for Wi-Fi Dashboard / Sensor nodes
    └── debug-loop.md        ← Iterative Build → Flash → Capture → Analyze cycle
```

---

## Rules (`rules/`)

Rules are platform-specific constraints that override the agent's default behavior. See `rules/skill-loading.md` for the full Skill Discovery Protocol.

| File | When to Load | Purpose |
|---|---|---|
| `rules/esp-terminal.md` | **Always.** | ALWAYS source ESP-IDF environment script before any `idf.py` command. |
| `rules/skill-loading.md` | **Always.** | Skill hierarchy: Workflows are entry points, Actions are internal subroutines. |

---

## Hardware (`boards/`)

Load the board file when the project targets a specific SoC.

| Board Target | Firmware Target | File |
|---|---|---|
| ESP32 DevKitC v4 | `esp32` | `boards/esp32-devkitc-v4.md` |

Targets use ESP-IDF chip names (e.g., `esp32`, `esp32s3`, `esp32c3`).

---

## SDKs (`sdks/`)

| SDK | File | When to Load |
|---|---|---|
| ESP-IDF | `sdks/esp-idf/SDK.md` | Load on first ESP-IDF project task. Contains `idf.py` and CMake reference. |
| Wi-Fi Stack | `sdks/esp-idf/protocols/WIFI.md` | Load when the project uses Wi-Fi or Webservers. |

---

## Platform Tools — `idf.py`

When working with this platform, `idf.py` is the official build and flash tool.
**CRITICAL:** You must follow `rules/esp-terminal.md` and load the environment before executing these tools.

### Key Device Commands
- `idf.py set-target <target>` — Sets the target (e.g. `esp32`)
- `idf.py menuconfig` — Interactive or headless Kconfig
- `idf.py build` — Build firmware (full reference in `actions/build.md`)
- `idf.py -p <port> flash` — Flash firmware to device (full reference in `actions/flash.md`)
- `idf.py -p <port> monitor` — Live UART logging (full reference in `actions/capture-logs.md`)

---

## Skill Library Index

The workflows and actions below are strict, custom-built skills. See `rules/skill-loading.md` for the mandatory loading protocol.

### Primary Entry-Point Workflows (START HERE)

When starting a new task, load one of these Workflows first.

| Workflow | File | Purpose |
|---|---|---|
| IoT App Generator | `workflows/iot-app-generator.md` | Guided generation of Wi-Fi Dashboard / Sensor integration applications. |
| Debug Loop | `workflows/debug-loop.md` | Iterative Build → Flash → Capture → Analyze cycle. |

### Internal Actions (loaded by Workflows only)

| Action | File | Purpose |
|---|---|---|
| Build | `actions/build.md` | Building firmware (`idf.py build`) |
| Flash | `actions/flash.md` | Flashing firmware (`idf.py flash`) |
| Capture Logs | `actions/capture-logs.md` | Background UART capture to `.log` file |
| Analyze Logs | `actions/analyze-logs.md` | Analyzing crash dumps, backtraces, Core Panics |
| Web Dashboard Dev | `actions/web-dashboard-dev.md` | Frontend (HTML/JS/CSS) best practices for ESP microcontrollers |

---

## Design Patterns (`patterns/`) — General-Purpose, Reusable

Established design solutions for common ESP32 tasks. **These patterns are project-agnostic and apply to any ESP32 application.** Load a pattern when implementing a similar feature.

| Pattern | File | Use Case | Applies To |
|---------|------|----------|-----------|
| Hardware Reading Loop | `patterns/sensor-task-pattern.md` | Periodic device reads (init, error handling, state tracking) | Temperature sensors, light sensors, ADC, GPIO, I2C, SPI, motion detectors, any hardware |
| Custom ESP-IDF Component | `patterns/component-development.md` | Creating reusable drivers with public API | DHT11, BME680, display drivers, motor controllers, communication modules, any hardware driver |
| Embedded Web Content | `patterns/embedded-html-pattern.md` | HTML/CSS/JS in C strings without filesystem | Device dashboards, config UIs, status pages, embedded web servers |
| REST API for Hardware | `patterns/http-api-design.md` | JSON responses with state tracking | Sensor readings, device metrics, real-time status, any HTTP endpoint |

**Quality Guarantee:** These patterns capture real solutions from production debugging. Each includes complete code templates adaptable to your specific hardware.

---

## Troubleshooting Guide (`troubleshooting/`)

Known issues with their root causes and solutions. Load when encountering build or runtime errors.

| Document | File | Covers |
|---|---|---|
| Build & Runtime | `troubleshooting/build-and-runtime.md` | Undefined reference errors, CMakeLists.txt issues, WiFi/HTTP initialization, sensor read timeouts, watchdog resets |

**Troubleshooting Strategy:** When a build or runtime error occurs, always check this guide first. Most ESP32 issues are configuration, initialization order, or missing dependencies.

---

## Quick Reference: Common Tasks

### "Build and flash my project"
1. Source environment: `. /home/omar/esp/v5.5.2/esp-idf/export.sh`
2. Load `workflows/debug-loop.md`
3. Build: `idf.py build`
4. Flash: `idf.py -p /dev/ttyUSB0 flash` (or your device port)

### "My build fails with undefined reference"
1. Load `troubleshooting/build-and-runtime.md`
2. Check CMakeLists.txt `SRCS` and `REQUIRES` sections
3. Verify component registration and include paths

### "I'm creating a new Wi-Fi + Sensor project"
1. Load `workflows/iot-app-generator.md`
2. Use `patterns/sensor-task-pattern.md` for sensor reading
3. Use `patterns/http-api-design.md` for JSON response format
4. Override HTML using `patterns/embedded-html-pattern.md` for dashboard

### "My sensor reads show 'Error' on startup"
1. Load `patterns/sensor-task-pattern.md` → see "State Machine" section
2. Add `initialized` flag to distinguish pre-read vs actual failure
3. frontend should show loading state until initialized=true

---

**Session Context (Latest Development Session)**

**Project:** WiFi weather station with DHT11 sensor reading every 2 seconds via FreeRTOS, HTTP dashboard, JSON API

**Patterns Extracted:**  
These 4 patterns were discovered and validated during this session, then generalized to be reusable across ALL ESP32 projects. They capture solutions to real problems, not DHT11-specific tricks. Any future ESP32 project (motion detection, light measurement, distance sensing, environmental monitoring, device control) will benefit from them.

**Project:** WiFi Weather Station with DHT11 Sensor (ESP32 DevKitC v4)

**What Was Built:**
- Custom DHT11 driver component (bit-banging protocol, no external libraries)
- FreeRTOS sensor task reading every 2 seconds with state machine
- HTTP server with HTML5 dashboard (`/`) and JSON API (`/api/data`)
- Responsive CSS dark theme with real-time updates via JavaScript polling

**Key Artifacts:**
- `components/dht11/dht11.c` — Working DHT11 protocol driver
- `main/main.c` — Full application (400+ lines, well-commented)
- Dashboard HTML embedded with proper quote escaping and responsive layout

**Why These Patterns Were Created:**
- **sensor-task-pattern.md:** Learned that sensor state machine (uninitialized → initialized → valid/error) prevents premature "Error" display
- **component-development.md:** Building custom components requires exact CMakeLists.txt registration and include path management
- **embedded-html-pattern.md:** Embedding HTML in C strings is fragile; requires explicit newline handling and careful quote escaping
- **http-api-design.md:** JSON responses need both `initialized` and `valid` flags for frontend to distinguish states
- **troubleshooting/build-and-runtime.md:** Documented 10+ issues (undefined app_main, minimal build linker failures, WiFi connection problems)

**Lessons for Next Dev:**
1. Always verify CMakeLists.txt `SRCS` lists your main file explicitly
2. Use state machine (timestamp + consecutive_failures) for robust sensor error handling
3. Test JSON API schema early; frontend state depends on correct field semantics
4. Quote escaping in embedded HTML is non-obvious; prefer single quotes in HTML attributes
5. Sensor initialization is not instant; provide feedback to user via UI status badge

---

## Resources

- **ESP-IDF Official:** https://docs.espressif.com/projects/esp-idf/
- **ESP32 DevKitC v4 Schematics:** https://docs.espressif.com/projects/esp-idf/en/latest/esp32/hw-reference/esp32/user-guide-devkitc-v4.html
- **FreeRTOS on ESP32:** https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/system/freertos.html
