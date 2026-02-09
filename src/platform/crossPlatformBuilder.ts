/**
 * Cross-Platform Command Builder
 * Handles OS-specific syntax differences for shell commands
 * Converts Linux/Mac style commands to Windows-compatible equivalents
 */

export interface CommandStep {
	command: string
	description?: string
}

export interface BuiltCommand {
	command: string
	shell: "bash" | "cmd" | "powershell"
	description: string
}

/**
 * Builds cross-platform command from array of steps
 *
 * Linux/Mac: Uses && to chain commands
 * Windows: Uses ; (semicolon) or separate commands with proper escaping
 *
 * Example:
 *   Input: ["cd ../project", "west build", "west flash"]
 *   Linux: "cd ../project && west build && west flash"
 *   Windows: "cd ../project; west build; west flash"
 */
export function buildCrossPlatformCommand(steps: CommandStep[]): BuiltCommand {
	const isWindows = process.platform === "win32"

	if (steps.length === 0) {
		return {
			command: "",
			shell: isWindows ? "cmd" : "bash",
			description: "Empty command",
		}
	}

	if (steps.length === 1) {
		return {
			command: steps[0].command,
			shell: isWindows ? "cmd" : "bash",
			description: steps[0].description || steps[0].command,
		}
	}

	// Multiple steps - chain them appropriately
	if (isWindows) {
		return buildWindowsCommand(steps)
	} else {
		return buildUnixCommand(steps)
	}
}

function buildUnixCommand(steps: CommandStep[]): BuiltCommand {
	const commands = steps.map((step) => step.command).join(" && ")
	const descriptions = steps.map((step) => step.description || step.command).join(" > ")

	return {
		command: commands,
		shell: "bash",
		description: descriptions,
	}
}

function buildWindowsCommand(steps: CommandStep[]): BuiltCommand {
	const commands = steps.map((step) => escapeWindowsCommand(step.command)).join(" & ")
	const descriptions = steps.map((step) => step.description || step.command).join(" > ")

	return {
		command: commands,
		shell: "cmd",
		description: descriptions,
	}
}

/**
 * Escape Windows command for safe execution in cmd.exe
 * Handles parentheses, special characters, paths with spaces, etc.
 */
function escapeWindowsCommand(cmd: string): string {
	// If command contains pipes or redirects, wrap in quotes
	if (cmd.includes("|") || cmd.includes(">") || cmd.includes("<")) {
		return `"${cmd}"`
	}

	// If command contains spaces and parentheses (likely a complex expression), wrap in quotes
	if (cmd.includes(" ") && (cmd.includes("(") || cmd.includes(")"))) {
		return `"${cmd}"`
	}

	// Otherwise, return as-is
	return cmd
}

/**
 * Convert Linux-style path to Windows-compatible path (if on Windows)
 * Example: ../project/build → ..\project\build
 */
export function convertPathToOSStyle(linuxPath: string): string {
	const isWindows = process.platform === "win32"

	if (!isWindows) {
		return linuxPath
	}

	// Replace forward slashes with backslashes
	return linuxPath.replace(/\//g, "\\")
}

/**
 * Common task: directory change + command execution
 * Handles chaining cd + build steps safely
 */
export function buildChangeDirectoryAndExecute(directory: string, command: string, description?: string): BuiltCommand {
	const cdCommand = process.platform === "win32" ? `cd /d "${directory}"` : `cd "${directory}"`

	return buildCrossPlatformCommand([
		{ command: cdCommand, description: `Change to ${directory}` },
		{ command, description: description || command },
	])
}

/**
 * Add delay between commands
 * Windows: timeout /T seconds /NOBREAK
 * Unix: sleep seconds
 */
export function buildDelayCommand(seconds: number): string {
	const isWindows = process.platform === "win32"
	return isWindows ? `timeout /T ${seconds} /NOBREAK` : `sleep ${seconds}`
}

/**
 * Build a wait-and-then-execute command
 * Useful for device reset scenarios
 */
export function buildWaitAndExecute(waitSeconds: number, command: string): BuiltCommand {
	const delay = buildDelayCommand(waitSeconds)

	return buildCrossPlatformCommand([
		{ command: delay, description: `Wait ${waitSeconds}s` },
		{ command, description: command },
	])
}
