import { espToolActive } from "@/services/platform/platformRouting"
import { getCachedWorkspaceSummary } from "@/services/platform/WorkspaceClassifier"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * ESP Device Tool — run the ESP-IDF toolchain (`idf.py`, `esptool.py`, the IDF
 * python venv) in a terminal that has the ESP-IDF environment available. The
 * handler picks the terminal and sources the environment for you (it prefers the
 * Espressif extension's ESP-IDF terminal, else self-sources `export.sh`), so you
 * never source it yourself.
 *
 * IMPORTANT: execute_command MUST NOT be used for ESP-IDF tasks — a plain
 * terminal has no IDF environment and `idf.py` / `esptool.py` will not be found.
 */

/**
 * Platform gate (runtime). The ESP tool is advertised when the open workspace is
 * classified esp or both; it is hidden otherwise so an nRF-only or empty workspace
 * never advertises a tool its knowledge base doesn't use. Mirrors
 * trigger_nordic_action's isNrfActive.
 */
const isEspActive = (): boolean => espToolActive(getCachedWorkspaceSummary())

const TECHNICAL_REFERENCE = `
CRITICAL OPERATIONAL RULES:
1. ENVIRONMENT: Never run idf.py/esptool via execute_command. This tool provides the sourced ESP-IDF environment.
2. DEVICE IDENTITY (run BEFORE the first build/flash, via action="execute"): identify the connected chip and flash so you build for the right target.
   - "esptool.py flash_id"  → chip type + revision + features (WiFi/BLE) + flash (ROM) size in one call.
   - "idf.py --version"      → the ESP-IDF version.
   - "python -m serial.tools.list_ports"  → enumerate serial ports (which board is on which port).
   - PSRAM is a config fact: read sdkconfig (CONFIG_SPIRAM*), confirmed at runtime by the boot log ("Found 8MB SPI RAM device").
   - "idf.py size"  → app IRAM/DRAM/Flash usage (after a build).
3. TARGET: A project builds for one chip (esp32, esp32s3, esp32c3, esp32c6...). Set it with action="execute" command="idf.py set-target esp32s3" before the first build if it differs from sdkconfig's CONFIG_IDF_TARGET.
4. PORTS: discover the port ONCE (command="python -m serial.tools.list_ports"), then ALWAYS pass "port" to flash and monitor. A portless flash/monitor makes esptool open every serial device (/dev/ttyS0..S31 on Linux) one by one before finding the board, and picks the wrong one when two boards are attached. Linux: /dev/ttyUSB* or /dev/ttyACM*; macOS: /dev/cu.usbserial-* or /dev/cu.usbmodem*; Windows: COMx.
5. MONITOR = log capture: action="monitor" runs idf.py monitor for "duration" seconds and SAVES the serial output (panic backtraces already decoded to file:line) to logs/uart/<name>_<chip>_<port>_<ts>.log. It resets the board first by default (set reset="false" for mid-runtime capture). This is how you capture crashes/coredumps — do NOT run "idf.py monitor" via execute (it would hang).
   MULTI-BOARD: pass "devices" instead of "port" to capture two or more boards CONCURRENTLY in one call (e.g. a BLE central + peripheral pair). Format: "name1:port1:/abs/path/project1,name2:port2:/abs/path/project2". Each board runs idf.py monitor inside its own project directory, in parallel, for the same "duration".
6. CLEAN/RECONFIG: use action="execute" with command="idf.py fullclean" or "idf.py reconfigure" when the build is in a bad state.
`

const PARAMETERS = [
	{
		name: "action",
		required: true,
		instruction: `The ESP-IDF action to perform. Options:
- "build":   Compile the project (idf.py build).
- "flash":   Flash the built firmware to the connected ESP32 (idf.py flash).
- "monitor": Capture the serial console to a log file for "duration" seconds, with panic backtraces decoded (wraps idf.py monitor). Use this to capture boot logs, crashes and coredumps.
- "execute": Run any other command in the IDF environment via the "command" parameter (idf.py subcommands, esptool.py, python).`,
		usage: "build",
	},
	{
		name: "command",
		required: false,
		instruction: `Required if action="execute". The FULL command to run in the IDF environment (include the binary name).
Examples:
- "idf.py set-target esp32s3"          (Select the chip before building)
- "idf.py --version"                   (ESP-IDF version)
- "idf.py size"                        (App Flash/RAM usage, after a build)
- "idf.py fullclean"                   (Wipe the build directory)
- "idf.py reconfigure"                 (Re-run CMake configure)
- "esptool.py flash_id"                (Connected chip type, revision, features, flash size)
- "python -m serial.tools.list_ports"  (Enumerate connected serial ports)`,
		usage: "esptool.py flash_id",
	},
	{
		name: "port",
		required: false,
		instruction: `For "flash" and single-board "monitor": the serial port of the target board. Discover it once via command="python -m serial.tools.list_ports", then pass it on EVERY flash/monitor (don't rely on auto-detect — it scans all ports and can pick the wrong board).
- Linux:   /dev/ttyUSB0 or /dev/ttyACM0
- macOS:   /dev/cu.usbserial-1410 or /dev/cu.usbmodem*
- Windows: COM5
For two or more boards at once, use "devices" instead.`,
		usage: "/dev/ttyACM0",
	},
	{
		name: "devices",
		required: false,
		instruction: `For "monitor" with multiple boards: comma-separated list of name:port:project entries (one per board). Captures all boards concurrently in a single call.
Format: "name:port:/abs/path/to/project" — the project path is the ESP-IDF project for that specific board.
Example (Windows): "central:COM8:C:\\Users\\Omar\\esp\\ble_central,peripheral:COM10:C:\\Users\\Omar\\esp\\ble_peripheral"
Example (Linux):   "central:/dev/ttyUSB0:/home/user/esp/ble_central,peripheral:/dev/ttyUSB1:/home/user/esp/ble_peripheral"
When "devices" is set, "port" and "name" parameters are ignored (name is embedded per-device in the tuple).`,
		usage: "central:COM8:C:\\projects\\ble_central,peripheral:COM10:C:\\projects\\ble_peripheral",
	},
	{
		name: "duration",
		required: false,
		instruction: `Optional for "monitor". Capture duration in seconds (default 10).
- Crash / boot capture: 10 seconds
- Connection / Wi-Fi debug: 20-30 seconds
- Stability test: 60+ seconds`,
		usage: "10",
	},
	{
		name: "name",
		required: false,
		instruction: `Optional for "monitor". A label used in the log filename (e.g. "boot", "wifi", "crash"). Defaults to the project/chip name.`,
		usage: "crash",
	},
	{
		name: "reset",
		required: false,
		instruction: `Optional for "monitor". Reset the board before capturing (DEFAULT: true — captures the full boot sequence). Set to "false" for mid-runtime capture without resetting.`,
		usage: "true",
	},
	{
		name: "idf_version",
		required: false,
		instruction: `Optional. The ESP-IDF version to build/flash with, e.g. "5.5.2".
You normally do NOT set this — the tool auto-resolves the version from the project's pin (dependencies.lock)
or uses the only installed version. Set it ONLY when the tool reports that multiple ESP-IDF versions are
installed and the project pins none: ask the user which to use, then pass it here. The choice is remembered
for this project, so you won't be asked again. Do NOT switch the Espressif extension's IDF selector or
source export.sh by hand — just pass this parameter.`,
		usage: "5.5.2",
	},
]

const DESCRIPTION = `Run the ESP-IDF toolchain in a terminal with the ESP-IDF environment sourced for you.

USE action="build" | "flash" for the core cycle, action="monitor" to CAPTURE serial logs/crashes to a file, or action="execute" with a "command" for any other idf.py/esptool/python command (including device identification: esptool.py flash_id, idf.py --version, idf.py size).
NEVER use execute_command for ESP-IDF tasks — a plain terminal has no IDF environment.`

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.ESP_ACTION,
	name: "triggerEspAction",
	contextRequirements: isEspActive,
	description: `${DESCRIPTION}
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.ESP_ACTION,
	name: ClineDefaultTool.ESP_ACTION,
	contextRequirements: isEspActive,
	description: `${DESCRIPTION}
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id: ClineDefaultTool.ESP_ACTION,
	name: ClineDefaultTool.ESP_ACTION,
	contextRequirements: isEspActive,
	description: `${DESCRIPTION}
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

export const trigger_esp_action_variants: ClineToolSpec[] = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
