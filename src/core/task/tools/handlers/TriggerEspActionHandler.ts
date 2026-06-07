import * as path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import * as vscode from "vscode"
import { markEspTerminalSourced, prepareEspTerminal, wrapEspCommand } from "@/hosts/vscode/hostbridge/workspace/executeEspCommand"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * Handler for ESP-IDF hardware actions. The ESP counterpart of
 * TriggerNordicActionHandler — runs the ESP-IDF toolchain in our own integrated
 * terminal, sourcing the IDF env once per terminal (see executeEspCommand). The
 * terminal is a normal shell so VS Code shell integration captures output
 * cleanly, unlike the Espressif extension's terminal.
 *
 * Actions:
 *   - build    → `idf.py -C <proj> build`
 *   - flash    → `idf.py -C <proj> [-p <port>] flash`
 *   - monitor  → run the capture wrapper (`assets/scripts/esp-monitor`) which
 *                wraps `idf.py monitor` for a duration and tees the serial output
 *                (panic backtraces already decoded by the monitor) to a
 *                correctly-named `logs/uart/<name>_<chip>_<port>_<ts>.log`.
 *   - execute  → run an arbitrary command in the IDF env, e.g. `idf.py size`,
 *                `idf.py set-target esp32s3`, `idf.py --version`,
 *                `esptool.py flash_id`, `python -m serial.tools.list_ports`.
 */
export class TriggerEspActionHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.ESP_ACTION

	private static readonly VALID_ACTIONS = new Set(["build", "flash", "monitor", "execute"])

	constructor(private context: vscode.ExtensionContext) {}

	getDescription(block: ToolUse): string {
		const action = block.params.action || "?"
		if (action === "execute") {
			const c = block.params.command || ""
			return `[ESP-IDF: ${c.length > 44 ? c.slice(0, 41) + "..." : c}]`
		}
		if (action === "monitor") {
			return `[ESP-IDF: capture serial logs]`
		}
		return `[ESP-IDF: idf.py ${action}]`
	}

	async handlePartialBlock(_block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// No partial handling needed for this tool.
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const action = (block.params.action || "").toLowerCase()

		if (!TriggerEspActionHandler.VALID_ACTIONS.has(action)) {
			config.taskState.consecutiveMistakeCount++
			const msg = `Invalid action '${block.params.action}'. Use "build", "flash", "monitor", or "execute".`
			await config.callbacks.say("error", msg)
			return formatResponse.toolError(msg)
		}

		const projectDir = config.cwd || process.cwd()

		// Resolve the raw command body for the requested action.
		let body: string
		let sayPath: string
		if (action === "execute") {
			const command = block.params.command
			if (!command) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "command")
			}
			body = command.trim()
			sayPath = body
		} else if (action === "monitor") {
			body = this.buildMonitorCommand(projectDir, block)
			sayPath = "Capture serial logs (idf.py monitor)"
		} else {
			// build / flash
			const port = block.params.port
			const portArg = port && action === "flash" ? `-p ${port} ` : ""
			body = `idf.py -C "${projectDir}" ${portArg}${action}`.trim()
			sayPath = `idf.py ${action}`
		}

		config.taskState.consecutiveMistakeCount = 0

		// Get our integrated terminal and shape the command: source the IDF env
		// only on the first command in that terminal (the env persists after),
		// bare on subsequent commands.
		const prepared = await prepareEspTerminal()
		const built = wrapEspCommand(body, prepared.needsSourcing)
		if (built.error || !built.command) {
			const msg = built.error || "Could not build the ESP-IDF command."
			await config.callbacks.say("error", msg)
			return formatResponse.toolError(msg)
		}

		await config.callbacks.say(
			"tool",
			JSON.stringify({
				tool: "triggerEspAction",
				path: sayPath,
			}),
		)

		const [, result] = await config.callbacks.executeCommandTool(built.command, undefined, prepared.terminalName, true)
		// The env is now sourced in this terminal — subsequent commands run bare.
		// Mark only after the sourced command ran (built.command existed ⇒ IDF_PATH resolved).
		if (prepared.needsSourcing) {
			markEspTerminalSourced(prepared.terminal)
		}
		return result
	}

	/**
	 * Build the capture-wrapper invocation for action="monitor". The wrapper runs
	 * `idf.py monitor` for `duration` seconds and tees to a correctly-named log
	 * file; the panic-backtrace decoding is done by idf.py monitor itself.
	 */
	private buildMonitorCommand(projectDir: string, block: ToolUse): string {
		const { port, duration, name, reset } = block.params as Record<string, string | undefined>

		const isWindows = process.platform === "win32"
		const wrapperName = isWindows ? "esp-monitor.bat" : "esp-monitor"
		const absoluteWrapperPath = path.join(this.context.extensionUri.fsPath, "assets", "scripts", wrapperName)

		// Prefer a short, workspace-relative path for cleaner terminal output.
		let wrapperPath = absoluteWrapperPath
		try {
			const rel = path.relative(projectDir, absoluteWrapperPath)
			if (!rel.startsWith("..") && rel.length < absoluteWrapperPath.length) {
				wrapperPath = (isWindows ? "" : "./") + rel
			}
		} catch {
			// keep absolute
		}
		const quote = (s: string) => (s.includes(" ") ? `"${s}"` : s)

		const args = [quote(wrapperPath), "--project", quote(projectDir)]
		if (port) args.push("--port", port)
		args.push("--duration", String(duration || "10"))
		if (name) args.push("--name", name)
		// Reset-before-capture is the default (captures the boot sequence). Only
		// skip it for mid-runtime capture, matching the nRF capture semantics.
		if (reset === "false") {
			args.push("--no-reset")
		}
		return args.join(" ")
	}
}
