import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * Nordic Terminal Tool - Execute commands in the nRF Connect terminal
 * This is the PRIMARY method for all Nordic/Zephyr development tasks.
 */

const CLI_REFERENCE = `
WEST COMMANDS:
  west build -b BOARD [path] [-p always]  Build project (pristine: -p always)
  west flash [--erase] [--recover]        Flash firmware
  west debug                              Start GDB session
  west sign -t imgtool                    Sign for MCUboot

NRFJPROG COMMANDS:
  nrfjprog --ids                          List connected debuggers
  nrfjprog --program FILE --verify        Program and verify
  nrfjprog --eraseall                     Erase all flash
  nrfjprog --recover                      Full recovery

COMMON BOARDS: nrf52dk, nrf52840dk, nrf52833dk, nrf5340dk, nrf52840dongle (Run "west boards | grep <chip>" for others)`

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
