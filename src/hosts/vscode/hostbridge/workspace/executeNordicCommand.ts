import { exec } from "node:child_process"
import * as fs from "node:fs"
import { promisify } from "node:util"
import * as vscode from "vscode"
import { getCachedNrfEnvironment, getResolvedNrfutil, type NrfutilCommands } from "@/services/nrf/EnvironmentDetector"
import { detectShell } from "./idfEnvResolver"
import { buildJLinkArgs, getJLinkBinaryName, resolveJLinkBinary, type SupportedPlatform } from "./jlinkResolver"
import {
	buildNordicLoggerCommand,
	buildToolchainCommand,
	type NcsSelection,
	ncsAmbiguousMessage,
	parseToolchainEnv,
	pathListSep,
	resolveDeviceCommand,
	type SupportedShell,
	selectNcsInstall,
	toNcsVersionFlag,
	toolchainUnavailableMessage,
} from "./nordicEnvResolver"

const execAsync = promisify(exec)

export interface ExecuteNordicCommandRequest {
	command: string
}

export interface ExecuteNordicCommandResponse {
	success: boolean
	extensionFound: boolean
	error?: string
}

export interface ExecuteInNordicTerminalRequest {
	command: string
}

export interface ExecuteInNordicTerminalResponse {
	success: boolean
	terminalFound: boolean
	terminalCreated: boolean
	error?: string
}

/**
 * Execute a Nordic nRF Connect SDK command via VS Code.
 * This abstraction allows the handler to avoid direct vscode API usage.
 */
export async function executeNordicCommand(request: ExecuteNordicCommandRequest): Promise<ExecuteNordicCommandResponse> {
	try {
		// Check if the nRF Connect extension is available
		const extension = vscode.extensions.getExtension("nordic-semiconductor.nrf-connect")

		if (!extension) {
			return {
				success: false,
				extensionFound: false,
				error: `nRF Connect Extension not detected. Please install the "nRF Connect Extension Pack" for the best experience.`,
			}
		}

		// Execute the VS Code command
		await vscode.commands.executeCommand(request.command)

		return {
			success: true,
			extensionFound: true,
		}
	} catch (error) {
		return {
			success: false,
			extensionFound: true,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Check if a terminal name indicates an nRF/Nordic terminal.
 * Matches: "nRF $(icons) v3.2.1", "nRF Connect", "NCS Terminal", etc.
 */
function isNordicTerminalName(name: string): boolean {
	const lowerName = name.toLowerCase()
	return (
		lowerName.startsWith("nrf") || // Matches "nRF $(icons)..." and "nrf-*"
		lowerName.includes("nordic") ||
		lowerName.includes("zephyr") ||
		lowerName.includes("ncs")
	)
}

/**
 * Find an existing nRF Connect terminal by name patterns.
 * IMPORTANT: This function ONLY returns terminals that are confirmed nRF/Nordic terminals.
 * It does NOT fallback to regular shells - that would break the SDK environment.
 */
export function findNordicTerminal(): vscode.Terminal | undefined {
	const terminals = vscode.window.terminals
	if (terminals.length === 0) {
		return undefined
	}

	// Find first terminal matching Nordic patterns
	for (const terminal of terminals) {
		if (isNordicTerminalName(terminal.name)) {
			return terminal
		}
	}

	// IMPORTANT: Do NOT fallback to activeTerminal or any other terminal!
	// Regular shells don't have the SDK environment variables set.
	// Returning undefined will trigger creation of a proper nRF terminal.
	return undefined
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Create the nRF Connect shell terminal and return it by REFERENCE — identified by
 * diffing `vscode.window.terminals` (plus `onDidOpenTerminal`) rather than by name.
 *
 * Why not match by name: the nRF Connect terminal's name is built dynamically and
 * has changed across extension releases (e.g. 2026.6.x no longer matches our
 * historical "nrf/zephyr/ncs" patterns), so name-matching a *freshly created*
 * terminal is unreliable and was the cause of "Failed to activate nRF Connect
 * Terminal" even though the terminal had clearly opened. The new terminal is simply
 * the one that wasn't there before the create command — whatever it is called.
 *
 * Returns undefined if the extension is absent or no new terminal appears in time.
 */
async function createNordicTerminalByDiff(): Promise<vscode.Terminal | undefined> {
	const extension = vscode.extensions.getExtension("nordic-semiconductor.nrf-connect")
	if (!extension) {
		return undefined
	}

	const before = new Set(vscode.window.terminals)
	let opened: vscode.Terminal | undefined
	const disposable = vscode.window.onDidOpenTerminal((t) => {
		if (!before.has(t)) {
			opened = opened ?? t
		}
	})

	try {
		// "Create Shell Terminal" — the NCS shell with the SDK environment active.
		await vscode.commands.executeCommand("nrf-connect.createNcsTerminal")

		// POLL up to 15s. Prefer the event-captured terminal; otherwise diff the list.
		for (let i = 0; i < 30; i++) {
			await delay(500)
			const appeared = opened ?? vscode.window.terminals.find((t) => !before.has(t))
			if (appeared) {
				return appeared
			}
		}
	} finally {
		disposable.dispose()
	}

	return undefined
}

/**
 * Execute a command in the nRF Connect terminal.
 * If no nRF terminal exists, creates one first.
 */
export async function executeInNordicTerminal(request: ExecuteInNordicTerminalRequest): Promise<ExecuteInNordicTerminalResponse> {
	try {
		// Fast path: reuse an existing nRF terminal we can recognize by name.
		let terminal = findNordicTerminal()
		let terminalCreated = false

		// Otherwise create one and capture it by reference (name-agnostic).
		if (!terminal) {
			terminal = await createNordicTerminalByDiff()
			terminalCreated = !!terminal

			if (!terminal) {
				return {
					success: false,
					terminalFound: false,
					terminalCreated: false,
					error: "Could not find or create nRF Connect terminal. Please open an nRF Connect terminal manually.",
				}
			}
		}

		// Show the terminal and execute the command
		terminal.show()
		terminal.sendText(request.command, true)

		return {
			success: true,
			terminalFound: true,
			terminalCreated,
		}
	} catch (error) {
		return {
			success: false,
			terminalFound: false,
			terminalCreated: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * The nRF terminal we last opened/adopted (Tier 3). Cached by REFERENCE because the
 * new nRF Connect extension names its terminal in a way our `findNordicTerminal`
 * name patterns can miss — without this cache we'd fail to recognize the terminal we
 * just created and open ANOTHER one (and re-trigger its version QuickPick) on every
 * command, piling up unused terminals. Cleared when the user closes it.
 */
let _lastNordicTerminal: vscode.Terminal | undefined
let _nordicCloseListenerRegistered = false
function ensureNordicCloseListener(): void {
	if (_nordicCloseListenerRegistered) return
	_nordicCloseListenerRegistered = true
	vscode.window.onDidCloseTerminal((t) => {
		if (t === _lastNordicTerminal) _lastNordicTerminal = undefined
	})
}

/**
 * Activate/create the nRF Connect terminal without executing a command.
 * This ensures the SDK environment is active for subsequent commands.
 */
export async function activateNordicTerminal(): Promise<string | undefined> {
	ensureNordicCloseListener()

	// Priority 0: the exact terminal we opened before (if still alive). This is what keeps Tier 3 from
	// creating a new terminal — and re-showing the version picker — on every single command.
	if (_lastNordicTerminal && vscode.window.terminals.includes(_lastNordicTerminal)) {
		_lastNordicTerminal.show()
		return _lastNordicTerminal.name
	}

	// Priority 1: reuse an existing nRF terminal we can recognize by name.
	let terminal = findNordicTerminal()
	if (terminal) {
		_lastNordicTerminal = terminal
		terminal.show()
		return terminal.name
	}

	// Priority 2: create one and capture it by REFERENCE (diff + onDidOpenTerminal),
	// not by name — the new nRF Connect extension names its terminal in a way our
	// historical name patterns miss, which is exactly what made activation "fail"
	// even though the terminal opened.
	terminal = await createNordicTerminalByDiff()
	if (terminal) {
		_lastNordicTerminal = terminal
		terminal.show()
		return terminal.name
	}

	// If we still can't find it, log the running terminals to help debugging.
	const visibleTerminals = vscode.window.terminals.map((t) => t.name).join(", ")
	console.warn(`[Nordic] Failed to find nRF terminal after creation attempts. Visible terminals: ${visibleTerminals}`)

	return undefined
}

// ============================================================
// SELF-CONTAINED "Adsum nRF" TERMINAL (Tiers 1 & 2)
//
// We run nRF dev commands in OUR OWN terminal so they (a) never depend on the
// extension's createNcsTerminal QuickPick (the v3.2.1-vs-v3.3.0 race) and (b) get
// clean VS Code shell-integration output capture. The NCS toolchain env is sourced
// in the BACKGROUND (host-side child_process), so the developer only sees the bare
// dev command. Three tiers, auto-degrading:
//   1. inject the toolchain env into our terminal → run a BARE command (cleanest)
//   2. visible single `nrfutil … toolchain launch -- <cmd>` (no shell chaining)
//   3. fall back to the extension's nRF terminal (the functions above)
// ============================================================

/** Distinct name so we only ever reuse OUR terminal, never the extension's. */
const ADSUM_NRF_TERMINAL_NAME = "Adsum nRF"

/** Narrow the host's `process.platform` to the resolver's supported set. */
export function hostPlatform(): SupportedPlatform {
	if (process.platform === "win32") return "win32"
	if (process.platform === "darwin") return "darwin"
	return "linux"
}

/** Our own nRF terminal + the env signature it was created with (env is fixed at creation). */
let _adsumNrfTerminal: vscode.Terminal | undefined
let _adsumNrfSignature: string | undefined
let _adsumCloseListenerRegistered = false
function ensureAdsumCloseListener(): void {
	if (_adsumCloseListenerRegistered) return
	_adsumCloseListenerRegistered = true
	vscode.window.onDidCloseTerminal((t) => {
		if (t === _adsumNrfTerminal) {
			_adsumNrfTerminal = undefined
			_adsumNrfSignature = undefined
		}
	})
}

/** Find our own nRF terminal by exact name (covers a window reload where module state was lost). */
function findOurNrfTerminal(): vscode.Terminal | undefined {
	if (_adsumNrfTerminal) return _adsumNrfTerminal
	for (const t of vscode.window.terminals) {
		if (t.name === ADSUM_NRF_TERMINAL_NAME) return t
	}
	return undefined
}

/**
 * Get our single "Adsum nRF" terminal — never more than one. Reuse rules:
 *
 *   - `reuseAnyExisting` (logger / `nrfutil device` commands): reuse whatever
 *     "Adsum nRF" terminal is already open, regardless of env. Those commands only
 *     need nrfutil on PATH (present in any of our terminals), so there's no reason
 *     to recreate — this is what stops the terminal from thrashing when the agent
 *     alternates between capturing logs and building.
 *   - otherwise (toolchain commands): reuse when the env signature matches; only
 *     when it differs (e.g. the agent switched `ncs_version`) do we dispose the old
 *     one and create a fresh terminal — VS Code fixes a terminal's env at creation.
 *
 * Either way at most ONE "Adsum nRF" terminal exists, so terminals never pile up.
 *
 * CONFIRMED ROOT CAUSE FIX for "Terminal has already been disposed": the host's own
 * `VscodeTerminalManager.getOrCreateTerminal(cwd, "Adsum nRF")` (used by
 * `executeCommandTool` right after this function returns) does its OWN independent
 * name-based lookup, checking its `TerminalRegistry` first. `Terminal.exitStatus` —
 * which that registry uses to filter out closed terminals — is only set once VS Code's
 * `onDidCloseTerminal` event fires, an ASYNC step after `.dispose()` is called, not
 * synchronous with it. Disposing the old terminal and immediately creating+returning a
 * SAME-NAMED replacement left a window where the registry could still match the old,
 * already-disposed-by-us terminal by name (its `exitStatus` not updated yet) and hand
 * it back to `executeCommandTool`, which then crashed calling `.show()` on it. Awaiting
 * the close event before creating the replacement closes that window.
 */
async function prepareAdsumNrfTerminal(opts: {
	env?: Record<string, string>
	reuseAnyExisting?: boolean
}): Promise<vscode.Terminal> {
	ensureAdsumCloseListener()
	const { env, reuseAnyExisting } = opts
	const existing = findOurNrfTerminal()

	if (existing && reuseAnyExisting) {
		_adsumNrfTerminal = existing
		existing.show()
		return existing
	}

	const signature = env ? JSON.stringify(env) : "plain"
	if (existing && _adsumNrfSignature === signature) {
		_adsumNrfTerminal = existing
		existing.show()
		return existing
	}
	if (existing) {
		// Env must change — dispose the old one and WAIT for VS Code to confirm it's
		// actually closed (exitStatus set) before creating its same-named replacement.
		await new Promise<void>((resolve) => {
			const sub = vscode.window.onDidCloseTerminal((t) => {
				if (t !== existing) return
				sub.dispose()
				resolve()
			})
			existing.dispose()
			setTimeout(() => {
				sub.dispose()
				resolve()
			}, 2000)
		})
	}
	const terminal = vscode.window.createTerminal(
		env ? { name: ADSUM_NRF_TERMINAL_NAME, env } : { name: ADSUM_NRF_TERMINAL_NAME },
	)
	_adsumNrfTerminal = terminal
	_adsumNrfSignature = signature
	terminal.show()
	return terminal
}

export interface HostNcsSelection {
	selection: NcsSelection
	nrfutil: NrfutilCommands
	/** True when we can source a toolchain ourselves (Tiers 1/2). False → go to the Tier-3 nRF terminal. */
	sdkManagerAvailable: boolean
}

/**
 * Resolve which NCS version to use and how to invoke nrfutil, host-side. Reads the
 * cached nRF environment (installed versions + the project's pinned version) and
 * applies {@link selectNcsInstall}. Gated on `sdkManagerSource` specifically (NOT
 * the overall `source`) — sdk-manager is an independently-installed nrfutil plugin
 * and can be unresolvable even when `device` (and thus `source`) resolves fine.
 * `path-fallback` is treated as "not available" so we prefer the guaranteed-correct
 * nRF terminal over a PATH guess.
 */
export function selectHostNcs(opts: { explicit?: string; persisted?: string } = {}): HostNcsSelection {
	const env = getCachedNrfEnvironment()
	const nrfutil = getResolvedNrfutil()
	const installed = env.installedSdkVersions ?? []
	const pinned = env.projectSdk?.version
	const selection = selectNcsInstall(installed, { explicit: opts.explicit, persisted: opts.persisted, pinned })
	return { selection, nrfutil, sdkManagerAvailable: nrfutil.sdkManagerSource !== "path-fallback" }
}

/**
 * Capture the NCS toolchain environment host-side (hidden) for Tier 1. Runs
 * `nrfutil sdk-manager toolchain env --ncs-version v<ver>` and parses the
 * `KEY : VALUE` listing. Returns the env map, or null if the call/parse fails (the
 * caller then degrades to Tier 2). Never throws.
 */
export async function extractToolchainEnv(sdkManagerPrefix: string, version: string): Promise<Record<string, string> | null> {
	try {
		const cmd = `${sdkManagerPrefix} toolchain env --ncs-version ${toNcsVersionFlag(version)}`
		const { stdout } = await execAsync(cmd, { timeout: 20000, maxBuffer: 4 * 1024 * 1024 })
		const env = parseToolchainEnv(stdout)
		// Require at least PATH — a parse that found nothing usable is a failure, not a clean env.
		return env.PATH ? env : null
	} catch (e) {
		console.info(
			`[adsum][nrf] toolchain env extraction failed (will use 'toolchain launch'): ${e instanceof Error ? e.message : e}`,
		)
		return null
	}
}

/**
 * Derive `ZEPHYR_BASE` (`<NCS install dir>/zephyr`) for a resolved version from the
 * given install-path map (`getCachedNrfEnvironment().installedSdkPaths`, normalized
 * version → NCS root dir). Pure — exported for unit tests.
 *
 * CONFIRMED ROOT CAUSE FIX: `west` extension commands (`build`, `flash`, `boards`, …)
 * are only registered when west can locate the workspace — either by running with cwd
 * inside it, or via `ZEPHYR_BASE` set as an ENVIRONMENT VARIABLE (a `-z ZEPHYR_BASE`
 * CLI flag does NOT work for this — west builds its subcommand parser before parsing
 * that flag; verified end-to-end against Nordic's own west-troubleshooting docs and a
 * live nrfutil install). Without this, a "freestanding" NCS project (the common case —
 * an app outside the NCS workspace dir) makes `west build` fail with `west: unknown
 * command "build"` even though the toolchain itself is sourced correctly. Returns
 * undefined if the version's install dir isn't known (degrades to running without it —
 * same behavior as before this fix, not worse).
 */
export function deriveZephyrBase(
	platform: SupportedPlatform,
	version: string,
	installedSdkPaths: Record<string, string> | undefined,
): string | undefined {
	const installDir = installedSdkPaths?.[version]
	if (!installDir) {
		console.info(
			`[adsum][nrf] no install dir known for NCS v${version} — cannot set ZEPHYR_BASE (west extension commands may fail outside the workspace dir)`,
		)
		return undefined
	}
	const zephyrBase = platform === "win32" ? `${installDir}\\zephyr` : `${installDir}/zephyr`
	console.info(`[adsum][nrf] ZEPHYR_BASE=${zephyrBase} (from NCS v${version})`)
	return zephyrBase
}

/**
 * Build the env injected into our terminal: the toolchain env (Tier 1, optional)
 * with nrfutil's bin dir prepended to PATH, `ADSUM_NRFUTIL` set (so the logger
 * wrappers, which shell out to `nrfutil device …`, work without the nRF terminal),
 * and `ZEPHYR_BASE` (so `west` finds its extension commands regardless of cwd —
 * see {@link deriveZephyrBase}). PATH order: nrfutilDir → toolchain PATH → inherited.
 */
function buildNordicTerminalEnv(
	platform: SupportedPlatform,
	nrfutil: NrfutilCommands,
	toolchainEnv?: Record<string, string>,
	zephyrBase?: string,
): Record<string, string> | undefined {
	const env: Record<string, string> = { ...(toolchainEnv ?? {}) }
	const sep = pathListSep(platform)
	const pathParts: string[] = []
	if (nrfutil.binDir) pathParts.push(nrfutil.binDir)
	if (toolchainEnv?.PATH) pathParts.push(toolchainEnv.PATH)
	if (process.env.PATH) pathParts.push(process.env.PATH)
	if (pathParts.length > 0) env.PATH = pathParts.join(sep)
	if (nrfutil.nrfutilPath) env.ADSUM_NRFUTIL = nrfutil.nrfutilPath
	if (zephyrBase) env.ZEPHYR_BASE = zephyrBase
	return Object.keys(env).length > 0 ? env : undefined
}

export interface NordicExecutionPlan {
	terminalName: string
	command: string
	/** 1 = own terminal + injected toolchain env (or no-toolchain logger/device); 2 = visible launch wrap; 3 = nRF terminal. */
	tier: 1 | 2 | 3
}

export type NordicExecutionResult =
	| { kind: "ready"; plan: NordicExecutionPlan }
	| { kind: "error"; message: string }
	| { kind: "needsChoice"; message: string; versions: string[] }

/**
 * Prepare a command for execution and ensure the right terminal exists. The
 * caller then runs `plan.command` in `plan.terminalName` via the normal
 * executeCommandTool path (shell integration). Side effect: may create/recreate
 * the "Adsum nRF" terminal (Tiers 1/2) or the extension's nRF terminal (Tier 3).
 *
 * @param body              the dev command body (e.g. `west build …`) or a logger wrapper invocation
 * @param needsToolchain    true for west/build/flash/SDK commands; false for loggers + `nrfutil device`
 * @param isLoggerWrapper   true when `body` is a quoted wrapper path (needs the PowerShell call operator)
 */
export async function prepareNordicExecution(opts: {
	body: string
	needsToolchain: boolean
	isLoggerWrapper?: boolean
	explicitVersion?: string
	persistedVersion?: string
}): Promise<NordicExecutionResult> {
	const platform = hostPlatform()
	const shell: SupportedShell = detectShell(vscode.env.shell || "", platform)
	const { selection, nrfutil, sdkManagerAvailable } = selectHostNcs({
		explicit: opts.explicitVersion,
		persisted: opts.persistedVersion,
	})

	// Loggers and `nrfutil device …` don't need the SDK toolchain — run them bare in
	// our own terminal, with nrfutil reachable via injected PATH / ADSUM_NRFUTIL.
	if (!opts.needsToolchain) {
		const env = buildNordicTerminalEnv(platform, nrfutil)
		// Reuse any open "Adsum nRF" terminal (it already has nrfutil on PATH) — don't thrash it.
		const terminal = await prepareAdsumNrfTerminal({ env, reuseAnyExisting: true })
		// Normalize a bare `nrfutil device …` to the resolved device binary. On stock Windows the
		// only nrfutil is the extension's split `nrfutil-device.exe` (no `nrfutil` launcher on PATH),
		// so the bare form fails with "not recognized" — see resolveDeviceCommand. A rewrite produces
		// a (possibly quoted) absolute path, so it needs the same shell shaping as a logger wrapper
		// (PowerShell's `&` call operator).
		const resolvedBody = opts.isLoggerWrapper ? opts.body : resolveDeviceCommand(opts.body, nrfutil.devicePrefix)
		const needsShellShaping = opts.isLoggerWrapper || resolvedBody !== opts.body
		const command = needsShellShaping
			? buildNordicLoggerCommand({ platform, shell, wrapperInvocation: resolvedBody })
			: resolvedBody
		return { kind: "ready", plan: { terminalName: terminal.name, command, tier: 1 } }
	}

	// Toolchain-dependent. Ambiguous + sdk-manager usable is a case WE can resolve
	// ourselves — we just don't know which version yet. Ask the agent (which asks the
	// user once and re-calls with `ncs_version`) instead of silently falling to the
	// extension's terminal, which would pop ITS OWN version/toolchain picker.
	if (selection.kind === "ambiguous" && sdkManagerAvailable) {
		return { kind: "needsChoice", message: ncsAmbiguousMessage(selection.versions), versions: selection.versions }
	}

	// Otherwise — no version detected at all, or sdk-manager itself isn't usable — we
	// genuinely can't self-source, so fall back to the nRF Connect terminal (Tier 3),
	// which has the real toolchain env regardless of what our detection saw.
	const canSelfSource = selection.kind === "resolved" && sdkManagerAvailable
	if (!canSelfSource) {
		const reason =
			selection.kind === "none" ? "no NCS version detected by sdk-manager" : "nrfutil sdk-manager not resolvable here"
		const terminalName = await activateNordicTerminal()
		if (!terminalName) {
			// The nRF terminal is the last resort; only error if even that can't be opened.
			return { kind: "error", message: toolchainUnavailableMessage() }
		}
		console.info(`[adsum][nrf] tier 3 — using nRF terminal "${terminalName}" (${reason})`)
		return { kind: "ready", plan: { terminalName, command: opts.body, tier: 3 } }
	}
	const version = selection.version
	const zephyrBase = deriveZephyrBase(platform, version, getCachedNrfEnvironment().installedSdkPaths)

	// Tier 1: source the toolchain env in the background and inject it → bare command.
	const toolchainEnv = await extractToolchainEnv(nrfutil.sdkManagerPrefix, version)
	if (toolchainEnv) {
		const env = buildNordicTerminalEnv(platform, nrfutil, toolchainEnv, zephyrBase)
		const terminal = await prepareAdsumNrfTerminal({ env })
		console.info(`[adsum][nrf] tier 1 — injected NCS v${version} toolchain env into "${terminal.name}"`)
		return { kind: "ready", plan: { terminalName: terminal.name, command: opts.body, tier: 1 } }
	}

	// Tier 2: visible single launch command (no shell chaining), still nrfutil-on-PATH for safety.
	// NOT reuseAnyExisting: the terminal env now carries ZEPHYR_BASE for THIS version, so a
	// version switch must recreate it — reusing blindly would serve a stale ZEPHYR_BASE.
	const env = buildNordicTerminalEnv(platform, nrfutil, undefined, zephyrBase)
	const terminal = await prepareAdsumNrfTerminal({ env })
	const command = buildToolchainCommand("ncs", { sdkManagerPrefix: nrfutil.sdkManagerPrefix, version, body: opts.body })
	console.info(`[adsum][nrf] tier 2 — 'toolchain launch' wrap for NCS v${version} in "${terminal.name}"`)
	return { kind: "ready", plan: { terminalName: terminal.name, command, tier: 2 } }
}

// ============================================================
// RTT AUTOMATION FUNCTIONS
// ============================================================

export interface RTTConnectionResult {
	success: boolean
	method: "plan_a" | "plan_b" | "none"
	error?: string
	terminalName?: string
}

/**
 * Connect to RTT using Plan A: VS Code nRF Terminal command.
 * This triggers the nRF Terminal extension's RTT connection.
 * Note: May show GUI picker if device selection is needed.
 */
export async function connectRTTPlanA(): Promise<RTTConnectionResult> {
	try {
		// Check if nRF Terminal extension is available
		const terminalExt = vscode.extensions.getExtension("nordic-semiconductor.nrf-terminal")
		if (!terminalExt) {
			return {
				success: false,
				method: "plan_a",
				error: "nRF Terminal extension not found. Install the nRF Connect Extension Pack.",
			}
		}

		// Try the nRF Terminal command with RTT connection type
		await vscode.commands.executeCommand("nrf-terminal.startTerminal", { connectionType: "rtt" })

		// Wait for terminal to appear
		await new Promise((resolve) => setTimeout(resolve, 2000))

		// Check if an RTT terminal was created
		const rttTerminal = vscode.window.terminals.find(
			(t) => t.name.toLowerCase().includes("rtt") || t.name.toLowerCase().includes("terminal"),
		)

		if (rttTerminal) {
			rttTerminal.show()
			return {
				success: true,
				method: "plan_a",
				terminalName: rttTerminal.name,
			}
		}

		return {
			success: false,
			method: "plan_a",
			error: "RTT terminal was not created. User may have cancelled device selection.",
		}
	} catch (error) {
		return {
			success: false,
			method: "plan_a",
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Connect to RTT using Plan B: spawn the SEGGER J-Link interactive CLI directly.
 *
 * Cross-platform behavior:
 * - Windows uses `JLink.exe`, macOS/Linux use `JLinkExe` (SEGGER's naming).
 * - We invoke the binary directly via VS Code's `createTerminal({ shellPath,
 *   shellArgs })`. No shell wrapper (`/bin/bash`, `cmd /c`) — that means no
 *   quoting concerns and the same code path works on every OS.
 * - Binary location is resolved by walking deterministic install paths,
 *   versioned SEGGER directories, then PATH. If nothing is found we fail
 *   loudly with a useful error rather than letting VS Code silently spawn
 *   the wrong thing.
 *
 * @param serialNumber - Device serial number from `nrfjprog --ids`
 * @param deviceName - Target device (default: nRF52840_xxAA)
 * @param rttPort - RTT telnet port (default: 19021)
 */
export async function connectRTTPlanB(
	serialNumber: string,
	deviceName: string = "nRF52840_xxAA",
	rttPort: number = 19021,
): Promise<RTTConnectionResult> {
	try {
		const terminalName = `RTT (${serialNumber})`

		const existingTerminal = vscode.window.terminals.find((t) => t.name === terminalName)
		if (existingTerminal) {
			existingTerminal.show()
			return {
				success: true,
				method: "plan_b",
				terminalName: existingTerminal.name,
			}
		}

		const platform = process.platform as SupportedPlatform
		const jlinkPath = resolveJLinkBinary(platform, process.env, fs.existsSync, (dir) => fs.readdirSync(dir))

		if (!jlinkPath) {
			const binaryName = getJLinkBinaryName(platform)
			return {
				success: false,
				method: "plan_b",
				error:
					`Could not locate ${binaryName}. Install SEGGER J-Link from ` +
					"https://www.segger.com/downloads/jlink/ or add it to PATH.",
			}
		}

		const terminal = vscode.window.createTerminal({
			name: terminalName,
			shellPath: jlinkPath,
			shellArgs: buildJLinkArgs({ deviceName, serialNumber, rttPort }),
		})

		terminal.show()

		// Give J-Link a moment to connect before the caller assumes the
		// terminal is live (e.g. before issuing follow-up RTT reads).
		await new Promise((resolve) => setTimeout(resolve, 3000))

		return {
			success: true,
			method: "plan_b",
			terminalName: terminal.name,
		}
	} catch (error) {
		return {
			success: false,
			method: "plan_b",
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Try to connect to RTT automatically.
 * First tries Plan A (VS Code command), falls back to Plan B (JLinkExe) if that fails.
 * @param serialNumber - Optional serial number for Plan B fallback
 * @param deviceName - Optional device name for Plan B fallback
 */
export async function connectRTT(serialNumber?: string, deviceName?: string): Promise<RTTConnectionResult> {
	// Try Plan A first
	const planAResult = await connectRTTPlanA()
	if (planAResult.success) {
		return planAResult
	}

	// If Plan A failed and we have serial number, try Plan B
	if (serialNumber) {
		console.log("[Nordic] Plan A RTT failed, attempting Plan B with JLinkExe...")
		return await connectRTTPlanB(serialNumber, deviceName)
	}

	// Neither worked
	return {
		success: false,
		method: "none",
		error: `Plan A failed: ${planAResult.error}. Plan B requires serial number.`,
	}
}
