import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * Nordic Terminal Tool - Execute commands in the nRF Connect terminal
 * This is the PRIMARY method for all Nordic/Zephyr development tasks.
 */

const CLI_REFERENCE = `
BEFORE STARTING (DYNAMIC CONTEXT):
  • CHECK for "nrf-doc/NRF52_BEST_PRACTICES_GUIDE.md"
  • IF EXISTS: READ IT! It overrides any rules below with project-specific strategies.

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

UART LOGGING (If RTT disabled / CONFIG_LOG_BACKEND_UART=y):
  • SINGLE DEVICE: timeout 20s sh -c 'nrfjprog --reset -s <SN> && sleep 1 && cat /dev/ttyACM0'
  • MULTI-DEVICE (Advanced):
      mkdir -p logs
      (timeout 20s cat /dev/ttyACM0 > logs/dev0.log &)
      (timeout 20s cat /dev/ttyACM1 > logs/dev1.log &)
      nrfjprog --reset -s <SN1>; nrfjprog --reset -s <SN2>

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

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: "trigger_nordic_action",
	description: `Execute commands in the nRF Connect terminal with the correct Nordic/Zephyr SDK environment. This is the ONLY method to use for west, nrfjprog, nrfutil, and other Nordic CLI tools.
${CLI_REFERENCE}`,
	parameters: [
		{
			name: "action",
			required: true,
			instruction: `Must be "execute" - runs the command in the nRF Connect terminal.`,
			usage: "execute",
		},
		{
			name: "command",
			required: true,
			instruction: `The shell command to run in the nRF Connect terminal. Use west, nrfjprog, nrfutil commands.
Examples:
- "west boards | grep nrf52840" (Find correct board name)
- "west build -b nrf52840dk ." (Build for specific board)
- "west flash --erase"
- "west debug"
- "nrfjprog --eraseall"
- "nrfjprog --program build/zephyr/zephyr.hex --verify"`,
			usage: "west build -b nrf52840dk .",
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: ClineDefaultTool.NORDIC_ACTION,
	description: `Execute commands in nRF Connect terminal. ALWAYS use this for west/nrfjprog commands.
${CLI_REFERENCE}`,
	parameters: [
		{
			name: "action",
			required: true,
			instruction: 'Must be "execute".',
		},
		{
			name: "command",
			required: true,
			instruction: 'Command to run. E.g., "west build -b nrf52840dk ."',
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id: ClineDefaultTool.NORDIC_ACTION,
	name: ClineDefaultTool.NORDIC_ACTION,
	description: `Execute commands in the nRF Connect terminal with correct Nordic/Zephyr environment. ALWAYS use this for west, nrfjprog, nrfutil commands.
${CLI_REFERENCE}`,
	parameters: [
		{
			name: "action",
			required: true,
			instruction: 'Must be "execute" - runs command in nRF terminal.',
		},
		{
			name: "command",
			required: true,
			instruction: `Command to run in nRF terminal. Examples:
- "west build -b nrf52840dk ." 
- "west flash --erase"
- "nrfjprog --eraseall"`,
		},
	],
}

export const trigger_nordic_action_variants: ClineToolSpec[] = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
