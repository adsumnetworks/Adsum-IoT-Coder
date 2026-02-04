import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * Nordic Terminal Tool - Execute commands in the nRF Connect terminal
 * This is the PRIMARY method for all Nordic/Zephyr development tasks.
 */

const CLI_REFERENCE = `
BEFORE STARTING (Living Document Rule):
  • FIRST ACTION: Check for NRF52_BEST_PRACTICES_GUIDE.md in workspace root and read if exists
  • This guide is your DYNAMIC CONTEXT fed by the user's real project experience
  • Prioritize guide rules over static instructions when conflict arises

AUTONOMY RULES (CRITICAL):
  • NEVER ask user to run "nrfjprog", "west", or "cat" commands. YOU run them.
  • NEVER use generic shell for "west" or "nrfjprog". ALWAYS use this tool.
  • IF FAIL: Ask user "Is Green LED blinking? Is USB connected?" before blaming code.

BOARD NAME FORMAT (REQUIRED):
  • nrf52840dk/nrf52840 (NOT just "nrf52840dk")
  • Find name: west boards | grep <chip>

PROCESS CLEANUP (Crucial for stability):
  • Before separate/new task: pkill -9 JLink; pkill -9 nrfutil; sleep 1
  • PREVENT HANGS: Use "timeout 60s" for blocking commands (e.g. timeout 60s west flash)

FORBIDDEN COMMANDS (WASTEFUL/FLAKY):
  • DO NOT USE: hcitool, nRFConnectScanner, ble-scan (Host scanning fails in containers)
  • DO NOT USE: nrfjprog --family --info (Use --ids instead)

VERIFICATION STRATEGY (TRUST THE LOGS):
  1. PRIMARY: RTT or UART logs showing boot & functionality.
  2. SECONDARY: Ask user ("Do you see LED blinking?").
  3. NEVER scan from the host machine.

RTT LOGGING (THE "PERFECT" SEQUENCE):
  1. Check RTT enabled: grep CONFIG_USE_SEGGER_RTT prj.conf
  2. Cleanup: pkill -9 JLink; pkill -9 nrfutil; sleep 1
  3. Connect: Use "nRF RTT Terminal" (VS Code) or JLinkExe (Plan B)
  4. RESET (Crucial): In a NEW terminal, run: nrfjprog --reset -s <serial>
  5. Observe: Watch RTT terminal immediately to catch boot logs
  6. MISSING LOGS? Check prj.conf for CONFIG_LOG_DEFAULT_LEVEL=4 (Debug)

UART LOGGING (Access via 'log_device' action):
  • LIST PORTS: action="log_device", operation="list"
  • PRE-FLIGHT TEST (2 sec): action="log_device", operation="test", port="/dev/ttyACM0"
  • CAPTURE LOGS: action="log_device", operation="capture", port="/dev/ttyACM0", duration="30", output="logs/"
  • MULTI-DEVICE: action="log_device", operation="capture", devices="central:/dev/ttyACM0,peripheral:/dev/ttyACM1", duration="60", output="logs/"
  • IF NO LOGS: Ask user "Is USB connected? Try unplug/replug device"

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
		instruction: `Optional for "log_device". Options: 
- "uart" (default): Use serial port (requires "port" or "devices" as /dev/ttyACM*).
- "rtt": Use J-Link RTT (requires "port" or "devices" as Serial Numbers, e.g. 683335182).
CRITICAL: If you are using Serial Numbers (9-digit IDs), you MUST set transport="rtt".`,
		usage: "rtt",
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
		instruction: `Optional for "capture". Recording duration in seconds. Default: 30.`,
		usage: "30",
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
