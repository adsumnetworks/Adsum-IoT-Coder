import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

/**
 * WARNING: This tool should NOT be used for Nordic/Zephyr SDK commands.
 * For west, nrfjprog, nrfutil, cmake in nRF projects, use trigger_nordic_action.
 */
const NORDIC_WARNING = `
⚠️ NORDIC DEVELOPMENT WARNING: Do NOT use this tool for west, nrfjprog, nrfutil, cmake commands, OR serial port access (cat /dev/ttyACM*, screen, minicom) in nRF/Zephyr projects. These MUST be run via trigger_nordic_action to ensure correct SDK environment variables are set and reliable logging.`

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.BASH,
	name: "execute_command",
	description: `Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands will be executed in the current working directory: {{CWD}}{{MULTI_ROOT_HINT}}${NORDIC_WARNING}`,
	parameters: [
		{
			name: "command",
			required: true,
			instruction: `The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.`,
			usage: "Your command here",
		},
		{
			name: "requires_approval",
			required: true,
			instruction:
				"A boolean indicating whether this command requires explicit user approval before execution in case the user has auto-approve mode enabled. Set to 'true' for potentially impactful operations like installing/uninstalling packages, deleting/overwriting files, system configuration changes, network operations, or any commands that could have unintended side effects. Set to 'false' for safe operations like reading files/directories, running development servers, building projects, and other non-destructive operations.",
			usage: "true or false",
			type: "boolean",
		},
		{
			name: "timeout",
			required: false,
			type: "integer",
			contextRequirements: (context) => context.yoloModeToggled === true,
			instruction:
				"Integer representing the timeout in seconds for how long to run the terminal command, before timing out and continuing the task.",
			usage: "30",
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.BASH,
	name: ClineDefaultTool.BASH,
	description: `Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task.${NORDIC_WARNING}`,
	parameters: [
		{
			name: "command",
			required: true,
			instruction:
				"The CLI command to execute. This should be valid for the current operating system. Do not use the ~ character or $HOME to refer to the home directory. Always use absolute paths. The command will be executed from the current workspace, you do not need to cd to the workspace.",
		},
		{
			name: "requires_approval",
			required: true,
			instruction:
				"To indicate whether this command requires explicit user approval or interaction before it should be executed. For system/file altering operations like installing/uninstalling packages, removing/overwriting files, system configuration changes, network operations, or any commands that are considered potentially dangerous must be set to true. False for safe operations like running development servers, building projects, and other non-destructive operations.",
			type: "boolean",
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id: ClineDefaultTool.BASH,
	name: ClineDefaultTool.BASH,
	description: `Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. When chaining commands, use the shell operator && (not the HTML entity &amp;&amp;). If using search/grep commands, be careful to not use vague search terms that may return thousands of results. When in PLAN MODE, you may use the execute_command tool, but only in a non-destructive manner and in a way that does not alter any files.${NORDIC_WARNING}`,
	parameters: [
		{
			name: "command",
			required: true,
			instruction:
				"The CLI command to execute. This should be valid for the current operating system. For command chaining, use proper shell operators like && to chain commands (e.g., 'cd path && command'). Do not use the ~ character or $HOME to refer to the home directory. Always use absolute paths. Do not run search/grep commands that may return thousands of results.",
		},
		{
			name: "requires_approval",
			required: true,
			instruction:
				"To indicate whether this command requires explicit user approval or interaction before it should be executed. For system/file altering operations like installing/uninstalling packages, removing/overwriting files, system configuration changes, network operations, or any commands that are considered potentially dangerous must be set to true. False for safe operations like running development servers, building projects, and other non-destructive operations.",
			type: "boolean",
		},
	],
}

export const execute_command_variants: ClineToolSpec[] = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
