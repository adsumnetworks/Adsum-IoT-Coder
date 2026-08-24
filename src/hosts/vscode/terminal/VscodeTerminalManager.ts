import { arePathsEqual } from "@utils/path"
import { getShellForProfile } from "@utils/shell"
import pWaitFor from "p-wait-for"
import * as vscode from "vscode"
import {
	TerminalInfo as ITerminalInfo,
	ITerminalManager,
	TerminalProcessResultPromise as ITerminalProcessResultPromise,
} from "@/integrations/terminal/types"
import { runShellIntegrationDoctor } from "./ShellIntegrationDoctor"
import { mergePromise, VscodeTerminalProcess } from "./VscodeTerminalProcess"
import { TerminalInfo, TerminalRegistry } from "./VscodeTerminalRegistry"

/*
TerminalManager:
- Creates/reuses terminals
- Runs commands via runCommand(), returning a TerminalProcess
- Handles shell integration events

TerminalProcess extends EventEmitter and implements Promise:
- Emits 'line' events with output while promise is pending
- process.continue() resolves promise and stops event emission
- Allows real-time output handling or background execution

getUnretrievedOutput() fetches latest output for ongoing commands

Enables flexible command execution:
- Await for completion
- Listen to real-time events
- Continue execution in background
- Retrieve missed output later

Notes:
- it turns out some shellIntegration APIs are available on cursor, although not on older versions of vscode
- "By default, the shell integration script should automatically activate on supported shells launched from VS Code."
Supported shells:
Linux/macOS: bash, fish, pwsh, zsh
Windows: pwsh


Example:

const terminalManager = new TerminalManager(context);

// Run a command
const process = terminalManager.runCommand('npm install', '/path/to/project');

process.on('line', (line) => {
	console.log(line);
});

// To wait for the process to complete naturally:
await process;

// Or to continue execution even if the command is still running:
process.continue();

// Later, if you need to get the unretrieved output:
const unretrievedOutput = terminalManager.getUnretrievedOutput(terminalId);
console.log('Unretrieved output:', unretrievedOutput);

Resources:
- https://github.com/microsoft/vscode/issues/226655
- https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api
- https://code.visualstudio.com/docs/terminal/shell-integration
- https://code.visualstudio.com/api/references/vscode-api#Terminal
- https://github.com/microsoft/vscode-extension-samples/blob/main/terminal-sample/src/extension.ts
- https://github.com/microsoft/vscode-extension-samples/blob/main/shell-integration-sample/src/extension.ts
*/

/*
The new shellIntegration API gives us access to terminal command execution output handling.
However, we don't update our VSCode type definitions or engine requirements to maintain compatibility
with older VSCode versions. Users on older versions will automatically fall back to using sendText
for terminal command execution.
Interestingly, some environments like Cursor enable these APIs even without the latest VSCode engine.
This approach allows us to leverage advanced features when available while ensuring broad compatibility.
*/
declare module "vscode" {
	// https://github.com/microsoft/vscode/blob/f0417069c62e20f3667506f4b7e53ca0004b4e3e/src/vscode-dts/vscode.d.ts#L7442
	interface Terminal {
		shellIntegration?: {
			cwd?: vscode.Uri
			executeCommand?: (command: string) => {
				read: () => AsyncIterable<string>
			}
		}
	}
	// https://github.com/microsoft/vscode/blob/f0417069c62e20f3667506f4b7e53ca0004b4e3e/src/vscode-dts/vscode.d.ts#L10794
	interface Window {
		onDidStartTerminalShellExecution?: (
			listener: (e: any) => any,
			thisArgs?: any,
			disposables?: vscode.Disposable[],
		) => vscode.Disposable
	}
}

/**
 * The command that moves a shell to `cwd`, in the dialect that shell speaks.
 *
 * `cd "path"` is not universal. On Windows `cmd.exe` it changes directory but NOT drive — from `C:\\src` a
 * plain `cd "D:\\work"` silently leaves you on C:, and every relative path afterwards resolves in the wrong
 * tree with no error to notice. `cd /d` is the fix there. PowerShell's `cd` is an alias for `Set-Location`,
 * which does change drive, but `Set-Location -LiteralPath` is the honest form: a path containing `[` or `]`
 * is a wildcard pattern to PowerShell otherwise, and Windows users do have folders with brackets in them.
 *
 * Exported so the cross-platform behaviour is testable without a terminal.
 */
export function cdCommandFor(shellPath: string | undefined, cwd: string): string {
	const shell = (shellPath ?? "").toLowerCase()
	if (shell.includes("powershell") || shell.includes("pwsh")) {
		return `Set-Location -LiteralPath "${cwd}"`
	}
	if (shell.endsWith("cmd.exe") || shell.endsWith("cmd")) {
		return `cd /d "${cwd}"`
	}
	// bash, zsh, fish, sh — and the sane default when the profile is unknown.
	return `cd "${cwd}"`
}

export class VscodeTerminalManager implements ITerminalManager {
	private terminalIds: Set<number> = new Set()
	private processes: Map<number, VscodeTerminalProcess> = new Map()
	private disposables: vscode.Disposable[] = []
	private shellIntegrationTimeout: number = 4000
	private terminalReuseEnabled: boolean = true
	private terminalOutputLineLimit: number = 500
	private subagentTerminalOutputLineLimit: number = 2000
	private defaultTerminalProfile: string = "default"

	constructor() {
		let disposable: vscode.Disposable | undefined
		try {
			disposable = (vscode.window as vscode.Window).onDidStartTerminalShellExecution?.(async (e) => {
				// Creating a read stream here results in a more consistent output. This is most obvious when running the `date` command.
				e?.execution?.read()
			})
		} catch (_error) {
			// console.error("Error setting up onDidEndTerminalShellExecution", error)
		}
		if (disposable) {
			this.disposables.push(disposable)
		}

		// Add a listener for terminal state changes to detect CWD updates
		try {
			const stateChangeDisposable = vscode.window.onDidChangeTerminalState((terminal) => {
				const terminalInfo = this.findTerminalInfoByTerminal(terminal)
				if (terminalInfo && terminalInfo.pendingCwdChange && terminalInfo.cwdResolved) {
					// Check if CWD has been updated to match the expected path
					if (this.isCwdMatchingExpected(terminalInfo)) {
						const resolver = terminalInfo.cwdResolved.resolve
						terminalInfo.pendingCwdChange = undefined
						terminalInfo.cwdResolved = undefined
						resolver()
					}
				}
			})
			this.disposables.push(stateChangeDisposable)
		} catch (error) {
			console.error("Error setting up onDidChangeTerminalState", error)
		}
	}

	//Find a TerminalInfo by its VSCode Terminal instance
	private findTerminalInfoByTerminal(terminal: vscode.Terminal): TerminalInfo | undefined {
		const terminals = TerminalRegistry.getAllTerminals()
		return terminals.find((t) => t.terminal === terminal)
	}

	//Check if a terminal's CWD matches its expected pending change
	private isCwdMatchingExpected(terminalInfo: TerminalInfo): boolean {
		if (!terminalInfo.pendingCwdChange) {
			return false
		}

		const currentCwd = terminalInfo.terminal.shellIntegration?.cwd?.fsPath
		const targetCwd = vscode.Uri.file(terminalInfo.pendingCwdChange).fsPath

		if (!currentCwd) {
			return false
		}

		return arePathsEqual(currentCwd, targetCwd)
	}

	runCommand(terminalInfo: ITerminalInfo, command: string): ITerminalProcessResultPromise {
		// Cast to VSCode-specific TerminalInfo for internal use
		// Using unknown as intermediate cast due to structural differences between ITerminal and vscode.Terminal
		const vscodeTerminalInfo = terminalInfo as unknown as TerminalInfo
		console.log(`[TerminalManager] Running command on terminal ${vscodeTerminalInfo.id}: "${command}"`)
		console.log(`[TerminalManager] Terminal ${vscodeTerminalInfo.id} busy state before: ${vscodeTerminalInfo.busy}`)

		vscodeTerminalInfo.busy = true
		vscodeTerminalInfo.lastCommand = command
		const process = new VscodeTerminalProcess()
		this.processes.set(vscodeTerminalInfo.id, process)

		process.once("completed", () => {
			console.log(`[TerminalManager] Terminal ${vscodeTerminalInfo.id} completed, setting busy to false`)
			vscodeTerminalInfo.busy = false
		})

		// if shell integration is not available, remove terminal so it does not get reused as it may be running a long-running process
		process.once("no_shell_integration", () => {
			console.log(`no_shell_integration received for terminal ${vscodeTerminalInfo.id}`)
			// Remove the terminal so we can't reuse it (in case it's running a long-running process)
			TerminalRegistry.removeTerminal(vscodeTerminalInfo.id)
			this.terminalIds.delete(vscodeTerminalInfo.id)
			this.processes.delete(vscodeTerminalInfo.id)
			// Integration demonstrably failed here — diagnose the known Windows causes and offer the fix.
			void runShellIntegrationDoctor("shell_integration_warning").catch(() => {})
		})

		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => {
				resolve()
			})
			process.once("error", (error) => {
				console.error(`Error in terminal ${vscodeTerminalInfo.id}:`, error)
				reject(error)
			})
		})

		// if shell integration is already active, run the command immediately
		if (vscodeTerminalInfo.terminal.shellIntegration) {
			process.waitForShellIntegration = false
			process.run(vscodeTerminalInfo.terminal, command)
		} else {
			// docs recommend waiting 3s for shell integration to activate
			console.log(
				`[TerminalManager Test] Waiting for shell integration for terminal ${vscodeTerminalInfo.id} with timeout ${this.shellIntegrationTimeout}ms`,
			)
			pWaitFor(() => vscodeTerminalInfo.terminal.shellIntegration !== undefined, {
				timeout: this.shellIntegrationTimeout,
			})
				.then(() => {
					console.log(
						`[TerminalManager Test] Shell integration activated for terminal ${vscodeTerminalInfo.id} within timeout.`,
					)
				})
				.catch((err) => {
					console.warn(
						`[TerminalManager Test] Shell integration timed out or failed for terminal ${vscodeTerminalInfo.id}: ${err.message}`,
					)
				})
				.finally(() => {
					console.log(`[TerminalManager Test] Proceeding with command execution for terminal ${vscodeTerminalInfo.id}.`)
					const existingProcess = this.processes.get(vscodeTerminalInfo.id)
					if (existingProcess && existingProcess.waitForShellIntegration) {
						existingProcess.waitForShellIntegration = false
						existingProcess.run(vscodeTerminalInfo.terminal, command)
					}
				})
		}

		return mergePromise(process, promise)
	}

	/**
	 * Put a terminal in `cwd`, whatever directory it is currently sitting in.
	 *
	 * One implementation, used by every path that hands back an existing terminal — the two name-matching
	 * branches and the reuse-any-free-terminal branch. It was written inline in the last of those; the first
	 * two simply did not do it, which is the whole defect.
	 *
	 * Returns quietly when the shell never reports its directory: shell integration is what supplies
	 * `shellIntegration.cwd`, and a terminal without it cannot be verified — issuing the `cd` and carrying on
	 * beats refusing to run.
	 */
	private async ensureTerminalCwd(info: TerminalInfo, cwd: string): Promise<void> {
		const current = info.terminal.shellIntegration?.cwd
		if (current && arePathsEqual(vscode.Uri.file(cwd).fsPath, current.fsPath)) {
			return
		}
		console.log(`[TerminalManager] Terminal ${info.id} is in ${current?.fsPath ?? "an unknown directory"}, moving to ${cwd}`)
		const cwdPromise = new Promise<void>((resolve, reject) => {
			info.pendingCwdChange = cwd
			info.cwdResolved = { resolve, reject }
		})
		await this.runCommand(info as unknown as ITerminalInfo, cdCommandFor(info.shellPath, cwd))
		await new Promise((resolve) => setTimeout(resolve, 100))
		if (this.isCwdMatchingExpected(info)) {
			info.cwdResolved?.resolve()
			info.pendingCwdChange = undefined
			info.cwdResolved = undefined
			return
		}
		try {
			await Promise.race([
				cwdPromise,
				new Promise<void>((_, reject) =>
					setTimeout(() => reject(new Error(`CWD timeout: Failed to update to ${cwd}`)), 1000),
				),
			])
		} catch (_err) {
			info.pendingCwdChange = undefined
			info.cwdResolved = undefined
		}
	}

	async getOrCreateTerminal(cwd: string, terminalName?: string): Promise<ITerminalInfo> {
		const terminals = TerminalRegistry.getAllTerminals()
		const expectedShellPath =
			this.defaultTerminalProfile !== "default" ? getShellForProfile(this.defaultTerminalProfile) : undefined

		// If a specific terminal name is requested, try to find it
		if (terminalName) {
			// First check our registry
			const namedTerminal = terminals.find((t) => t.terminal.name.toLowerCase().includes(terminalName.toLowerCase()))
			if (namedTerminal) {
				console.log(`[TerminalManager] Found registered terminal matching name "${terminalName}"`)
				// A NAME IS NOT A DIRECTORY. This branch used to return the terminal as found, skipping the
				// cwd matching every other path performs — so a terminal left in some earlier task's folder
				// was handed back and every command ran there. Observed 2026-08-24: the workspace was
				// /tmp/nus-demo/central_uart and the adopted "Adsum IoT Coder" terminal sat in
				// ~/ncs/v3.4.0/nrf/samples/bluetooth/central_uart, so a CRA run listed a compliance/ folder
				// that existed in the workspace and not there, found nothing, and stalled on the emptiness.
				// It looks like "it used to work": a fresh window has no stale named terminal to adopt.
				await this.ensureTerminalCwd(namedTerminal, cwd)
				this.terminalIds.add(namedTerminal.id)
				return namedTerminal as unknown as ITerminalInfo
			}

			// Then check all VS Code terminals (adoption logic)
			const externalTerminal = vscode.window.terminals.find((t) =>
				t.name.toLowerCase().includes(terminalName.toLowerCase()),
			)
			if (externalTerminal) {
				console.log(`[TerminalManager] Found external terminal matching name "${terminalName}", adopting it.`)
				const newInfo = TerminalRegistry.registerTerminal(externalTerminal)
				// Adopted from the window, so its directory is whatever the last person to use it left behind.
				await this.ensureTerminalCwd(newInfo, cwd)
				this.terminalIds.add(newInfo.id)
				return newInfo as unknown as ITerminalInfo
			}
		}

		// Find available terminal from our pool first (created for this task)
		console.log(`[TerminalManager] Looking for terminal in cwd: ${cwd}`)
		console.log(`[TerminalManager] Available terminals: ${terminals.length}`)

		const matchingTerminal = terminals.find((t) => {
			if (t.busy) {
				console.log(`[TerminalManager] Terminal ${t.id} is busy, skipping`)
				return false
			}
			// Check if shell path matches current configuration
			if (t.shellPath !== expectedShellPath) {
				return false
			}
			const terminalCwd = t.terminal.shellIntegration?.cwd // one of cline's commands could have changed the cwd of the terminal
			if (!terminalCwd) {
				console.log(`[TerminalManager] Terminal ${t.id} has no cwd, skipping`)
				return false
			}
			const matches = arePathsEqual(vscode.Uri.file(cwd).fsPath, terminalCwd.fsPath)
			console.log(`[TerminalManager] Terminal ${t.id} cwd: ${terminalCwd.fsPath}, matches: ${matches}`)
			return matches
		})
		if (matchingTerminal) {
			console.log(`[TerminalManager] Found matching terminal ${matchingTerminal.id} in correct cwd`)
			this.terminalIds.add(matchingTerminal.id)
			// Cast to ITerminalInfo for interface compatibility
			return matchingTerminal as unknown as ITerminalInfo
		}

		// If no non-busy terminal in the current working dir exists and terminal reuse is enabled, try to find any non-busy terminal regardless of CWD
		if (this.terminalReuseEnabled) {
			const availableTerminal = terminals.find((t) => !t.busy && t.shellPath === expectedShellPath)
			if (availableTerminal) {
				// Same navigation the named branches now perform — one implementation, not three.
				await this.ensureTerminalCwd(availableTerminal, cwd)
				this.terminalIds.add(availableTerminal.id)
				// Cast to ITerminalInfo for interface compatibility
				return availableTerminal as unknown as ITerminalInfo
			}
		}

		// If all terminals are busy or don't match shell profile, create a new one with the configured shell
		const newTerminalInfo = TerminalRegistry.createTerminal(cwd, expectedShellPath)
		this.terminalIds.add(newTerminalInfo.id)
		// Cast to ITerminalInfo for interface compatibility
		return newTerminalInfo as unknown as ITerminalInfo
	}

	getTerminals(busy: boolean): { id: number; lastCommand: string }[] {
		return Array.from(this.terminalIds)
			.map((id) => TerminalRegistry.getTerminal(id))
			.filter((t): t is TerminalInfo => t !== undefined && t.busy === busy)
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }))
	}

	getUnretrievedOutput(terminalId: number): string {
		if (!this.terminalIds.has(terminalId)) {
			return ""
		}
		const process = this.processes.get(terminalId)
		return process ? process.getUnretrievedOutput() : ""
	}

	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	disposeAll() {
		// for (const info of this.terminals) {
		// 	//info.terminal.dispose() // dont want to dispose terminals when task is aborted
		// }
		this.terminalIds.clear()
		this.processes.clear()
		this.disposables.forEach((disposable) => disposable.dispose())
		this.disposables = []
	}

	setShellIntegrationTimeout(timeout: number): void {
		this.shellIntegrationTimeout = timeout
	}

	setTerminalReuseEnabled(enabled: boolean): void {
		this.terminalReuseEnabled = enabled
	}

	setTerminalOutputLineLimit(limit: number): void {
		this.terminalOutputLineLimit = limit
	}

	setSubagentTerminalOutputLineLimit(limit: number): void {
		this.subagentTerminalOutputLineLimit = limit
	}

	public processOutput(outputLines: string[], overrideLimit?: number, isSubagentCommand?: boolean): string {
		const limit = isSubagentCommand
			? overrideLimit !== undefined
				? overrideLimit
				: this.subagentTerminalOutputLineLimit
			: this.terminalOutputLineLimit
		if (outputLines.length > limit) {
			const halfLimit = Math.floor(limit / 2)
			const start = outputLines.slice(0, halfLimit)
			const end = outputLines.slice(outputLines.length - halfLimit)
			return `${start.join("\n")}\n... (output truncated) ...\n${end.join("\n")}`.trim()
		}
		return outputLines.join("\n").trim()
	}

	setDefaultTerminalProfile(profileId: string): { closedCount: number; busyTerminals: TerminalInfo[] } {
		// Only handle terminal change if profile actually changed
		if (this.defaultTerminalProfile === profileId) {
			return { closedCount: 0, busyTerminals: [] }
		}

		const _oldProfileId = this.defaultTerminalProfile
		this.defaultTerminalProfile = profileId

		// Get the shell path for the new profile
		const newShellPath = profileId !== "default" ? getShellForProfile(profileId) : undefined

		// Handle terminal management for the profile change
		const result = this.handleTerminalProfileChange(newShellPath)

		// Update lastActive for any remaining terminals
		const allTerminals = TerminalRegistry.getAllTerminals()
		allTerminals.forEach((terminal) => {
			if (terminal.shellPath !== newShellPath) {
				TerminalRegistry.updateTerminal(terminal.id, { lastActive: Date.now() })
			}
		})

		return result
	}

	/**
	 * Filters terminals based on a provided criteria function
	 * @param filterFn Function that accepts TerminalInfo and returns boolean
	 * @returns Array of terminals that match the criteria
	 */
	filterTerminals(filterFn: (terminal: TerminalInfo) => boolean): TerminalInfo[] {
		const terminals = TerminalRegistry.getAllTerminals()
		return terminals.filter(filterFn)
	}

	/**
	 * Closes terminals that match the provided criteria
	 * @param filterFn Function that accepts TerminalInfo and returns boolean for terminals to close
	 * @param force If true, closes even busy terminals (with warning)
	 * @returns Number of terminals closed
	 */
	closeTerminals(filterFn: (terminal: TerminalInfo) => boolean, force: boolean = false): number {
		const terminalsToClose = this.filterTerminals(filterFn)
		let closedCount = 0

		for (const terminalInfo of terminalsToClose) {
			// Skip busy terminals unless force is true
			if (terminalInfo.busy && !force) {
				continue
			}

			// Remove from our tracking
			if (this.terminalIds.has(terminalInfo.id)) {
				this.terminalIds.delete(terminalInfo.id)
			}
			this.processes.delete(terminalInfo.id)

			// Dispose the actual terminal
			terminalInfo.terminal.dispose()

			// Remove from registry
			TerminalRegistry.removeTerminal(terminalInfo.id)

			closedCount++
		}

		return closedCount
	}

	/**
	 * Handles terminal management when the terminal profile changes
	 * @param newShellPath New shell path to use
	 * @returns Object with information about closed terminals and remaining busy terminals
	 */
	handleTerminalProfileChange(newShellPath: string | undefined): {
		closedCount: number
		busyTerminals: TerminalInfo[]
	} {
		// Close non-busy terminals with different shell path
		const closedCount = this.closeTerminals((terminal) => !terminal.busy && terminal.shellPath !== newShellPath, false)

		// Get remaining busy terminals with different shell path
		const busyTerminals = this.filterTerminals((terminal) => terminal.busy && terminal.shellPath !== newShellPath)

		return {
			closedCount,
			busyTerminals,
		}
	}

	/**
	 * Forces closure of all terminals (including busy ones)
	 * @returns Number of terminals closed
	 */
	closeAllTerminals(): number {
		return this.closeTerminals(() => true, true)
	}
}
