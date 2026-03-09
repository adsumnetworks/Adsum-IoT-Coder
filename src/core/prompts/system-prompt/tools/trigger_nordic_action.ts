import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * Nordic Terminal Tool - Execute commands in the nRF Connect terminal
 * This is the PRIMARY method for all Nordic/Zephyr development tasks.
 */

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
		instruction: `Required if action="log_device". Options: "list", "test", "capture", "monitor", "device_info".`,
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
- For RTT: The J-Link Serial Number (e.g. 683335182). CRITICAL: NEVER pass a COM port or /dev/tty* port when using RTT. RTT strictly uses 9-12 digit J-Link serial numbers.`,
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
- For RTT: identifier is the serial number (e.g. "central:683335182"). CRITICAL: NEVER pass a COM port or /dev/tty* port when using RTT. RTT strictly uses 9-12 digit J-Link serial numbers.`,
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

const TECHNICAL_REFERENCE = `
CRITICAL OPERATIONAL RULES:
1. BOARD NAMES: Must be full Zephyr ID (e.g., "nrf52840dk_nrf52840", NOT "nrf52840dk"). Use "west boards" to verify.
2. FLASHING:
   - Single device: "west flash"
   - Multiple devices: "west flash --snr <serial_number>" (REQUIRED to avoid ambiguity).
3. CLEANUP: Always run "pkill -9 JLink; pkill -9 nrfutil" before "log_device" or "west flash" to prevent lockups.
4. PORTS: Windows use COMx; Linux use /dev/ttyACMx.
5. DEVICE LISTING: ALWAYS use trigger_nordic_action(action="log_device", operation="list"). NEVER call nrfutil device list directly. NEVER use nrfjprog --ids on Windows.
`

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: "trigger_nordic_action",
	description: `Execute commands in the nRF Connect terminal with the correct Nordic/Zephyr SDK environment. This is the ONLY method to use for west, nrfjprog, nrfutil, and other Nordic CLI tools.
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: ClineDefaultTool.NORDIC_ACTION,
	description: `Execute commands in nRF Connect terminal or access Native Logger. ALWAYS use this for west/nrfjprog/logging.
${TECHNICAL_REFERENCE}`,
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
${TECHNICAL_REFERENCE}`,
	parameters: PARAMETERS,
}

export const trigger_nordic_action_variants: ClineToolSpec[] = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
