import { telemetryService } from "@services/telemetry"
import { openExternal } from "@utils/env"
import { execFile } from "child_process"
import { promisify } from "util"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"

const execFileAsync = promisify(execFile)

/**
 * ShellIntegrationDoctor — detects and automatically fixes, in the background, the Windows setups
 * that silently break VS Code terminal shell integration (which the extension needs to read
 * command output). No consent prompt: it runs at activation and repairs the machine before the
 * user runs their first command, so they simply find a working terminal (zero-manual-setup).
 *
 * Field-verified root causes on fresh Windows installs (runbook:
 * Adsum-Planning/operations/fix-shell-integration-windows.md):
 *  1. PowerShell execution policy is `Restricted` (the fresh-install default) — VS Code's
 *     shellIntegration.ps1 is a script, so it silently fails to load and the
 *     onDidStartTerminalShellIntegration API never activates.
 *  2. `terminal.integrated.defaultProfile.windows` unset or cmd.exe — no shell-integration shell.
 *  3. `terminal.integrated.shellIntegration.enabled` explicitly set to false.
 *
 * Triggered from extension activation (fix before the first command runs) and again from the
 * `no_shell_integration` terminal event (fallback if activation somehow missed it). The only
 * user-facing message is the Group-Policy case (unfixable) and a brief confirmation after a fix.
 */

export type DoctorTrigger = "activation" | "shell_integration_warning"

export interface ShellIntegrationFinding {
	/** Effective policy is Restricted/AllSigned — scripts blocked, the confirmed root cause. */
	policyBlocked: boolean
	/** MachinePolicy/UserPolicy (Group Policy) forces the policy — we must not try to override. */
	policyGpoManaged: boolean
	/** terminal.integrated.defaultProfile.windows is unset or points at cmd.exe. */
	profileMisconfigured: boolean
	/** terminal.integrated.shellIntegration.enabled is explicitly false. */
	shellIntegrationDisabled: boolean
}

/** Effect boundary, injectable for unit tests. */
export interface DoctorIo {
	platform: NodeJS.Platform
	/** `Get-ExecutionPolicy` in a clean child process (inherited env var cleared). */
	getEffectivePolicy(): Promise<string>
	/** `Get-ExecutionPolicy -List` as scope→policy map. */
	getPolicyList(): Promise<Record<string, string>>
	/** `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force`. */
	setUserPolicyRemoteSigned(): Promise<void>
	getTerminalConfig<T>(key: string, defaultValue: T): T
	updateTerminalConfigGlobal(key: string, value: unknown): Promise<void>
	showWarning(message: string, ...items: string[]): Promise<string | undefined>
	showInfo(message: string): void
	showError(message: string): void
	killAllTerminals(): Promise<void>
	openLearnMore(): Promise<void>
}

const TROUBLESHOOTING_URL =
	"https://github.com/adsumnetworks/Adsum-IoT-Coder/blob/main/docs/troubleshooting/terminal-integration-guide.mdx"

const BLOCKED_POLICIES = ["restricted", "allsigned"]

const LEARN_MORE_BUTTON = "Learn more"

// The full path dodges PATH tampering; fall back to PATH resolution if windir is unset.
function windowsPowerShellPath(): string {
	const windir = process.env.windir || process.env.WINDIR
	return windir ? `${windir}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "powershell.exe"
}

async function runPowerShell(command: string): Promise<string> {
	// Strip the inherited process-scope policy (e.g. a Bypass flag from our own host) so the
	// child reports the machine's real effective policy, not ours.
	const env = { ...process.env }
	delete env.PSExecutionPolicyPreference
	const { stdout } = await execFileAsync(windowsPowerShellPath(), ["-NoProfile", "-NonInteractive", "-Command", command], {
		env,
		windowsHide: true,
		timeout: 15_000,
	})
	return stdout.trim()
}

function defaultIo(): DoctorIo {
	return {
		platform: process.platform,
		getEffectivePolicy: () => runPowerShell("Get-ExecutionPolicy"),
		getPolicyList: async () => {
			const out = await runPowerShell('Get-ExecutionPolicy -List | ForEach-Object { "$($_.Scope)=$($_.ExecutionPolicy)" }')
			const map: Record<string, string> = {}
			for (const line of out.split(/\r?\n/)) {
				const [scope, policy] = line.split("=")
				if (scope && policy) {
					map[scope.trim()] = policy.trim()
				}
			}
			return map
		},
		setUserPolicyRemoteSigned: async () => {
			try {
				await runPowerShell("Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force")
			} catch (error: any) {
				// When our own process runs under a Bypass override, Set-ExecutionPolicy emits a
				// PermissionDenied *warning* (ExecutionPolicyOverride) even though the CurrentUser
				// registry value was written. Swallow only that case — the caller re-verifies.
				const text = String(error?.message ?? error)
				if (!text.includes("ExecutionPolicyOverride")) {
					throw error
				}
			}
		},
		getTerminalConfig: <T>(key: string, defaultValue: T): T =>
			vscode.workspace.getConfiguration("terminal.integrated").get<T>(key, defaultValue),
		updateTerminalConfigGlobal: async (key: string, value: unknown) => {
			await vscode.workspace.getConfiguration("terminal.integrated").update(key, value, vscode.ConfigurationTarget.Global)
		},
		showWarning: async (message: string, ...items: string[]) => {
			const response = await HostProvider.window.showMessage({
				type: ShowMessageType.WARNING,
				message,
				options: { items },
			})
			return response.selectedOption
		},
		showInfo: (message: string) => {
			HostProvider.window.showMessage({ type: ShowMessageType.INFORMATION, message })
		},
		showError: (message: string) => {
			HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message })
		},
		killAllTerminals: async () => {
			await vscode.commands.executeCommand("workbench.action.terminal.killAll")
		},
		openLearnMore: () => openExternal(TROUBLESHOOTING_URL),
	}
}

export async function diagnose(io: DoctorIo): Promise<ShellIntegrationFinding> {
	const finding: ShellIntegrationFinding = {
		policyBlocked: false,
		policyGpoManaged: false,
		profileMisconfigured: false,
		shellIntegrationDisabled: false,
	}
	if (io.platform !== "win32") {
		return finding
	}

	try {
		const effective = (await io.getEffectivePolicy()).toLowerCase()
		finding.policyBlocked = BLOCKED_POLICIES.includes(effective)
		if (finding.policyBlocked) {
			const list = await io.getPolicyList()
			const gpoScopes = [list.MachinePolicy, list.UserPolicy]
			finding.policyGpoManaged = gpoScopes.some((p) => p !== undefined && p.toLowerCase() !== "undefined")
		}
	} catch {
		// PowerShell probe failed — don't guess; leave the policy flags healthy so we never
		// offer a fix we can't verify.
	}

	const profile = io.getTerminalConfig<string | null | undefined>("defaultProfile.windows", undefined)
	finding.profileMisconfigured = !profile || /command prompt|cmd/i.test(profile)

	finding.shellIntegrationDisabled = io.getTerminalConfig<boolean>("shellIntegration.enabled", true) === false

	return finding
}

/**
 * Decide whether the finding justifies interrupting the user.
 * A blocked policy is a proven blocker — offer on any trigger (activation included).
 * A profile/setting issue alone is only offered after integration actually failed
 * (`shell_integration_warning`) to avoid false-positive toasts for users whose terminals work.
 */
export function shouldOffer(finding: ShellIntegrationFinding, trigger: DoctorTrigger): boolean {
	if (finding.policyBlocked && !finding.policyGpoManaged) {
		return true
	}
	return trigger === "shell_integration_warning" && (finding.profileMisconfigured || finding.shellIntegrationDisabled)
}

export interface FixResult {
	ok: boolean
	/** Human-readable reason when ok=false. */
	failure?: string
}

export async function applyFixes(io: DoctorIo, finding: ShellIntegrationFinding): Promise<FixResult> {
	if (finding.policyBlocked && !finding.policyGpoManaged) {
		await io.setUserPolicyRemoteSigned()
		// Trust the verification, not the command: re-check in a clean child process.
		const effective = (await io.getEffectivePolicy()).toLowerCase()
		if (BLOCKED_POLICIES.includes(effective)) {
			return { ok: false, failure: `execution policy is still ${effective}` }
		}
	}
	if (finding.profileMisconfigured) {
		await io.updateTerminalConfigGlobal("defaultProfile.windows", "PowerShell")
	}
	if (finding.shellIntegrationDisabled) {
		await io.updateTerminalConfigGlobal("shellIntegration.enabled", true)
	}
	return { ok: true }
}

type DoctorOutcome = "detected" | "fixed" | "fix_failed" | "declined" | "gpo_blocked"

// Telemetry must never break the fix flow.
function track(outcome: DoctorOutcome, trigger: DoctorTrigger, finding: ShellIntegrationFinding): void {
	try {
		telemetryService.captureTerminalDoctor(outcome, { trigger, ...finding })
	} catch {
		// ignore
	}
}

// Act at most once per window session. Set only when we actually do something (fix or GPO
// notice) — a no-op activation pass must not block a later real failure from triggering.
let actedThisSession = false

/** Test-only reset for the session guard. */
export function resetDoctorSessionState(): void {
	actedThisSession = false
}

/**
 * Silently diagnose and (where possible) fix the Windows shell-integration blockers, so a user
 * who opens the extension later just finds a working terminal. Runs in the background at
 * activation and again if the `no_shell_integration` event ever fires. No consent prompt — the
 * only user-facing message is the Group-Policy case (which we can't fix) and a brief, dismissible
 * confirmation after a successful auto-fix (transparency about the security setting we changed).
 */
export async function runShellIntegrationDoctor(trigger: DoctorTrigger, io: DoctorIo = defaultIo()): Promise<void> {
	if (io.platform !== "win32" || actedThisSession) {
		return
	}

	const finding = await diagnose(io)

	// Group Policy forces the blocked policy — we can't override it. This is the one case that
	// genuinely needs the user (their IT), so surface it once.
	if (finding.policyBlocked && finding.policyGpoManaged) {
		actedThisSession = true
		track("gpo_blocked", trigger, finding)
		const choice = await io.showWarning(
			"PowerShell scripts are blocked by your organization's Group Policy, so Adsum IoT Coder can't read terminal output. Ask your IT admin to allow the RemoteSigned execution policy.",
			LEARN_MORE_BUTTON,
		)
		if (choice === LEARN_MORE_BUTTON) {
			await io.openLearnMore()
		}
		return
	}

	// Nothing to act on for this trigger (healthy, or a profile-only quirk we don't touch until an
	// actual failure). Leave the guard unset so a later real failure can still trigger.
	if (!shouldOffer(finding, trigger)) {
		return
	}

	actedThisSession = true
	track("detected", trigger, finding)

	try {
		const result = await applyFixes(io, finding)
		if (!result.ok) {
			track("fix_failed", trigger, finding)
			io.showError(
				`Adsum IoT Coder could not set up terminal integration automatically (${result.failure}). See the troubleshooting guide: ${TROUBLESHOOTING_URL}`,
			)
			return
		}
		track("fixed", trigger, finding)
		// Any terminal opened before the fix keeps the broken state — replace them so the next
		// command the agent runs uses a shell that picks up the new policy/profile.
		await io.killAllTerminals()
		io.showInfo(
			"Adsum IoT Coder set up your terminal for full command output (PowerShell execution policy set to RemoteSigned for your user).",
		)
	} catch (error: any) {
		track("fix_failed", trigger, finding)
		io.showError(
			`Adsum IoT Coder could not set up terminal integration automatically (${String(error?.message ?? error)}). See the troubleshooting guide: ${TROUBLESHOOTING_URL}`,
		)
	}
}
