import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * Nordic Terminal Tool - Execute commands in the nRF Connect terminal
 * This is the PRIMARY method for all Nordic/Zephyr development tasks.
 */

const CLI_REFERENCE = `
⚠️ INSTRUCTION HANDBOOK (MANDATORY REFERENCE):
  See: NORDIC_INSTRUCTION_HANDBOOK.md in this directory
  Status: MANDATORY - All variants MUST follow these rules
  Last Updated: 2026-02-09

FIRST ACTIONS (REQUIRED SEQUENCE):
  1. Read this tool spec COMPLETELY
  2. Check workspace for NRF52_BEST_PRACTICES_GUIDE.md + NORDIC_INSTRUCTION_HANDBOOK.md
  3. Check workspace for prj.conf (BEFORE any tool invocation)
  4. DO NOT skip steps 1-3 (agent behavior depends on this)

AUTONOMY RULES (MANDATORY):
  • NEVER ask user to run "nrfjprog", "west", "cat", or similar. YOU MUST run them.
  • NEVER use generic shell (execute_command) for "west", "nrfjprog", or log capture. ALWAYS use this tool.
  • NEVER call nrfjprog or nrfutil directly. Use trigger_nordic_action (script handles gracefully).
  • NEVER assume transport type. Always read prj.conf FIRST (RULE 1).
  • NEVER analyze old log files without user confirmation (RULE 2).

BOARD NAME FORMAT (REQUIRED):
  • nrf52840dk_nrf52840 (NOT "nrf52840dk" or "nrf52840")
  • Use: west boards | grep <chip> to find exact name
  • Example: nrf5340dk_nrf5340_cpuapp (app core of dual-core processor)

PROCESS CLEANUP (CRITICAL FOR STABILITY):
  • Before device operations: pkill -9 JLink; pkill -9 nrfutil; sleep 1
  • PREVENTS: J-Link hangs, port locks, stale processes
  • Use: timeout 60s for blocking commands (e.g., timeout 60s west flash)

PLATFORM GUIDANCE (MANDATORY TO FOLLOW):
  WINDOWS (PRIMARY):
    • Port format MUST be: COM3, COM5, COM12 (NOT /dev/ttyACM0)
    • Check Device Manager → Ports (COM & LPT) to verify
  LINUX (SECONDARY):
    • Port format MUST be: /dev/ttyACM0, /dev/ttyACM1
    • Permissions: ls -la /dev/ttyACM0 (must have rw)
  macOS:
    • Port format: /dev/tty.usbserial-* or /dev/cu.usbserial-*

CRITICAL AGENT RULES - LOG CAPTURE & TRANSPORT (MANDATORY - NOT OPTIONAL):
  ⭐ RULE 1: TRANSPORT SELECTION - Auto-Detect First (MANDATORY)
    Step 1 (REQUIRED): Read prj.conf BEFORE doing anything else
      grep -i "CONFIG_USE_SEGGER_RTT\|CONFIG_LOG_BACKEND_UART" prj.conf
    Step 2 (REQUIRED): Apply transport logic
      IF CONFIG_USE_SEGGER_RTT=y OR CONFIG_LOG_BACKEND_RTT=y → MUST use transport="rtt"
      IF CONFIG_LOG_BACKEND_UART=y OR CONFIG_UART_CONSOLE=y → MUST use transport="uart"
      IF BOTH disabled → DEFAULT to transport="uart" (most common)
    Step 3 (REQUIRED): Verify your detection
      Port format COM3 or /dev/ttyACM0 → UART | 9-digit SN (683007782) → RTT
    FAILURE SYMPTOM: Agent uses UART for RTT-only project → EMPTY LOGS
    YOU MUST FOLLOW THIS: Non-negotiable for correct log capture

  ⭐ RULE 2: LOG CAPTURE vs FILE ANALYSIS - Fresh Logs by Default (MANDATORY)
    User says "show logs" or "capture logs" → YOU MUST capture FRESH from device (NEVER read old files)
    User explicitly says "analyze logs/" or "read this file" → THEN read old files (only after confirmation)
    CRITICAL: You MUST distinguish between "capturing new data" vs "analyzing old data"
    FAILURE SYMPTOM: Agent shows old logs from yesterday → User: "That's not current!"
    YOU MUST FOLLOW THIS: Non-negotiable for providing current information

  ⭐ RULE 3: DEVICE RESET - Let Script Handle Gracefully (MANDATORY)
    FORBIDDEN: Calling nrfjprog or nrfutil directly
    REQUIRED: Use trigger_nordic_action action="log_device" (script handles reset)
    Reset strategy (automatic in script):
      1. Try nrfutil (modern) → nrfutil device reset --serial-number <SN>
      2. If missing → Try nrfjprog (legacy) → nrfjprog --reset -s <SN>
      3. If both missing → WARN (not ERROR) and continue capturing
    FAILURE SYMPTOM: Agent runs "nrfjprog --reset" directly → tool not installed → agent fails
    YOU MUST FOLLOW THIS: Script abstraction is intentional for robustness

  ⭐ RULE 4: CAPTURE DURATION - Match Investigation Context (MANDATORY)
    Quick connection test: duration="5" (Is device responding?)
    Boot sequence capture: duration="15" (Capture complete startup)
    Normal debugging: duration="30" (standard session)
    Complex issues: duration="60" (extended investigation)
    FORBIDDEN: Default to 45+ seconds for quick tests
    FAILURE SYMPTOM: Agent uses 60s for "Is device connected?" → user waits unnecessarily
    YOU MUST FOLLOW THIS: Duration mismatches reveal instruction-following failures

  ⭐ RULE 5: PRE-CAPTURE DELAY - Catch Complete Boot Sequence (MANDATORY)
    When user says "show me boot logs" → YOU MUST use pre-capture-delay="3"
    When user says "capture boot sequence" → YOU MUST use pre-capture-delay="3"
    What it does: Starts listeners 3 seconds BEFORE device reset so they capture from first line
    Format: action="log_device" operation="capture" port="COM3" duration="15" pre-capture-delay="3"
    Result: Complete boot sequence captured (*** Booting nRF Connect SDK *** appears in logs)
    FAILURE SYMPTOM: Boot logs incomplete → missing first startup messages → pre-capture-delay not used
    YOU MUST FOLLOW THIS: Non-negotiable for complete boot diagnostics

DEVICE DETECTION - Use Modern Tools (MANDATORY):
  • List devices (PRIMARY): nrfutil device list
  • List devices (FALLBACK): nrfjprog --ids
  • Device reset (PRIMARY): nrfutil device reset --serial-number <SN>
  • Device reset (FALLBACK): nrfjprog --reset -s <SN>
  • REMEMBER devices from current session (don't ask user for serial twice)

FLASH PRIORITY:
  1. Get devices: nrfjprog --ids
  2. ONE device: timeout 60s west flash
  3. MULTIPLE: timeout 60s west flash --snr <serial>
  4. RECOVER: nrfjprog --recover (only if flash fails)

BUILD DECISION TREE:
  1. Check for build folder: ls build/ 2>/dev/null || echo "no build"
  2. If NO build/: west build -b BOARD .
  3. If build/ EXISTS:
     - Fresh rebuild: west build -b BOARD . -p always
     - Incremental: west build
`

const PARAMETERS = [
	{
		name: "action",
		required: true,
		instruction: `The action to perform. Options:
- "execute": Run a generic shell command (west, nrfjprog).
- "log_device": Run the native Nordic Logger tool (replaces external python scripts).`,
		usage: "execute",
	},
	{
		name: "command",
		required: false,
		instruction: `Required if action="execute". The shell command to run in the nRF Connect terminal. Use west, nrfjprog, nrfutil commands.
Examples:
- "west boards | grep nrf52840" (Find correct board name)
- "west build -b nrf52840dk ." (Build for specific board)
- "west flash --erase"
- "nrfjprog --eraseall"`,
		usage: "west build -b nrf52840dk .",
	},
	{
		name: "operation",
		required: false,
		instruction: `Required if action="log_device". Options: "list", "test", "capture", "monitor".`,
		usage: "list",
	},
	{
		name: "transport",
		required: false,
		instruction: `IMPORTANT: Always set explicitly based on user request or prj.conf detection.
- "uart": Serial port communication (COM3, /dev/ttyACM0). DEFAULT if not specified.
- "rtt": J-Link RTT (9-digit serial like 683335182). Only use if prj.conf shows CONFIG_USE_SEGGER_RTT=y

EXPLICIT RULE: 
✓ User says "capture UART logs" → MUST set transport="uart"
✓ User says "show logs from RTT" → MUST set transport="rtt"  
✓ prj.conf shows CONFIG_LOG_BACKEND_UART=y → set transport="uart"
✓ prj.conf shows CONFIG_USE_SEGGER_RTT=y → set transport="rtt"

If unsure, tool auto-detects from prj.conf, but ALWAYS pass explicit transport for clarity.`,
		usage: "uart",
	},
	{
		name: "port",
		required: false,
		instruction: `Required for "test", "capture", "monitor" (unless "devices" is used). 
- For UART: The serial port (e.g. /dev/ttyACM0, COM3).
- For RTT: The J-Link Serial Number (e.g. 683335182).`,
		usage: "/dev/ttyACM0",
	},
	{
		name: "duration",
		required: false,
		instruction: `Optional for "capture". Recording duration in seconds. 
- Quick test: 5 seconds
- Boot capture: 15 seconds  
- Standard: 30 seconds (default)
- Extended: 60+ seconds
Choose based on investigation goal.`,
		usage: "30",
	},
	{
		name: "pre-capture-delay",
		required: false,
		instruction: `Optional for "capture". Delay in seconds before device reset (pre-capture listening phase).
- Use for boot log capture: listeners start BEFORE reset
- Default: 0 (no delay)
- Recommended: 2-3 seconds for boot logs
This ensures complete boot sequence is captured.`,
		usage: "3",
	},
	{
		name: "devices",
		required: false,
		instruction: `Optional for "capture". Multi-device mapping: "name:identifier,name2:identifier2".
- For UART: identifier is the serial port (e.g. "central:/dev/ttyACM0").
- For RTT: identifier is the serial number (e.g. "central:683335182").`,
		usage: "central:683335182,peripheral:683007782",
	},
	{
		name: "output",
		required: false,
		instruction: `Optional for "capture". Directory to save logs.`,
		usage: "logs/",
	},
	{
		name: "reset",
		required: false,
		instruction: `Optional. Reset device(s) before capture. DEFAULT: true. Set to false ONLY for mid-runtime capture.`,
		usage: "true",
	},
	{
		name: "auto_detect",
		required: false,
		instruction: `Optional. Auto-detect all connected nRF devices. Set to true for BLE/multi-device scenarios where you want to capture everything without specifying ports.`,
		usage: "true",
	},
	{
		name: "list_nrf",
		required: false,
		instruction: `Optional. When true with operation="list", shows only nRF devices.`,
		usage: "true",
	},
]

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: "trigger_nordic_action",
	description: `Execute commands in the nRF Connect terminal with the correct Nordic/Zephyr SDK environment. This is the ONLY method to use for west, nrfjprog, nrfutil, and other Nordic CLI tools.
${CLI_REFERENCE}`,
	parameters: PARAMETERS,
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: ClineDefaultTool.NORDIC_ACTION,
	description: `Execute commands in nRF Connect terminal or access Native Logger. ALWAYS use this for west/nrfjprog/logging.
${CLI_REFERENCE}`,
	parameters: PARAMETERS,
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: ClineDefaultTool.NORDIC_ACTION,
	description: `Execute commands in the nRF Connect terminal or use Native Logger. ALWAYS use this for west, nrfjprog, nrfutil commands.
${CLI_REFERENCE}`,
	parameters: PARAMETERS,
}

export const trigger_nordic_action_variants: ClineToolSpec[] = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
