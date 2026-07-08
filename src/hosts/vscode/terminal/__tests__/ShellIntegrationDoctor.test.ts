import { expect } from "chai"
import { beforeEach, describe, it } from "mocha"
import {
	applyFixes,
	type DoctorIo,
	diagnose,
	resetDoctorSessionState,
	runShellIntegrationDoctor,
	type ShellIntegrationFinding,
	shouldOffer,
} from "../ShellIntegrationDoctor"

/** Mock io recording every effect; healthy Windows defaults, override per test. */
function makeIo(over: Partial<DoctorIo> & { calls?: string[] } = {}): DoctorIo & { calls: string[] } {
	const calls: string[] = over.calls ?? []
	return {
		platform: "win32",
		getEffectivePolicy: async () => "RemoteSigned",
		getPolicyList: async () => ({
			MachinePolicy: "Undefined",
			UserPolicy: "Undefined",
			Process: "Undefined",
			CurrentUser: "RemoteSigned",
			LocalMachine: "Undefined",
		}),
		setUserPolicyRemoteSigned: async () => {
			calls.push("setPolicy")
		},
		getTerminalConfig: <T>(key: string, defaultValue: T): T => {
			if (key === "defaultProfile.windows") {
				return "PowerShell" as unknown as T
			}
			return defaultValue
		},
		updateTerminalConfigGlobal: async (key: string, value: unknown) => {
			calls.push(`update:${key}=${value}`)
		},
		showWarning: async () => {
			calls.push("showWarning")
			return undefined
		},
		showInfo: (_message: string) => {
			calls.push("showInfo")
		},
		showError: (_message: string) => {
			calls.push("showError")
		},
		killAllTerminals: async () => {
			calls.push("killAllTerminals")
		},
		openLearnMore: async () => {
			calls.push("openLearnMore")
		},
		...over,
		calls,
	}
}

const finding = (over: Partial<ShellIntegrationFinding>): ShellIntegrationFinding => ({
	policyBlocked: false,
	policyGpoManaged: false,
	profileMisconfigured: false,
	shellIntegrationDisabled: false,
	...over,
})

describe("ShellIntegrationDoctor", () => {
	beforeEach(() => {
		resetDoctorSessionState()
	})

	describe("diagnose", () => {
		it("reports healthy on non-Windows without probing", async () => {
			const io = makeIo({
				platform: "linux",
				getEffectivePolicy: async () => {
					throw new Error("must not probe")
				},
			})
			const result = await diagnose(io)
			expect(result).to.deep.equal(finding({}))
		})

		it("flags Restricted policy as blocked (no GPO)", async () => {
			const io = makeIo({ getEffectivePolicy: async () => "Restricted" })
			const result = await diagnose(io)
			expect(result.policyBlocked).to.be.true
			expect(result.policyGpoManaged).to.be.false
		})

		it("flags AllSigned policy as blocked", async () => {
			const io = makeIo({ getEffectivePolicy: async () => "AllSigned" })
			const result = await diagnose(io)
			expect(result.policyBlocked).to.be.true
		})

		it("detects Group Policy management", async () => {
			const io = makeIo({
				getEffectivePolicy: async () => "Restricted",
				getPolicyList: async () => ({ MachinePolicy: "Restricted", UserPolicy: "Undefined" }),
			})
			const result = await diagnose(io)
			expect(result.policyBlocked).to.be.true
			expect(result.policyGpoManaged).to.be.true
		})

		it("treats a healthy policy as not blocked", async () => {
			const io = makeIo({ getEffectivePolicy: async () => "RemoteSigned" })
			const result = await diagnose(io)
			expect(result.policyBlocked).to.be.false
		})

		it("stays safe (healthy flags) when the PowerShell probe fails", async () => {
			const io = makeIo({
				getEffectivePolicy: async () => {
					throw new Error("spawn failed")
				},
			})
			const result = await diagnose(io)
			expect(result.policyBlocked).to.be.false
			expect(result.policyGpoManaged).to.be.false
		})

		it("flags an unset default profile", async () => {
			const io = makeIo({ getTerminalConfig: <T>(_key: string, defaultValue: T): T => defaultValue })
			const result = await diagnose(io)
			expect(result.profileMisconfigured).to.be.true
		})

		it("flags a cmd default profile", async () => {
			const io = makeIo({
				getTerminalConfig: <T>(key: string, defaultValue: T): T =>
					key === "defaultProfile.windows" ? ("Command Prompt" as unknown as T) : defaultValue,
			})
			const result = await diagnose(io)
			expect(result.profileMisconfigured).to.be.true
		})

		it("accepts a PowerShell default profile", async () => {
			const result = await diagnose(makeIo())
			expect(result.profileMisconfigured).to.be.false
		})

		it("flags shellIntegration.enabled=false", async () => {
			const io = makeIo({
				getTerminalConfig: <T>(key: string, defaultValue: T): T => {
					if (key === "shellIntegration.enabled") {
						return false as unknown as T
					}
					if (key === "defaultProfile.windows") {
						return "PowerShell" as unknown as T
					}
					return defaultValue
				},
			})
			const result = await diagnose(io)
			expect(result.shellIntegrationDisabled).to.be.true
		})
	})

	describe("shouldOffer", () => {
		it("offers on activation for a blocked policy", () => {
			expect(shouldOffer(finding({ policyBlocked: true }), "activation")).to.be.true
		})

		it("does NOT offer on activation for a profile-only issue (avoids false positives)", () => {
			expect(shouldOffer(finding({ profileMisconfigured: true }), "activation")).to.be.false
		})

		it("offers after a real failure for a profile-only issue", () => {
			expect(shouldOffer(finding({ profileMisconfigured: true }), "shell_integration_warning")).to.be.true
		})

		it("offers after a real failure when shellIntegration.enabled=false", () => {
			expect(shouldOffer(finding({ shellIntegrationDisabled: true }), "shell_integration_warning")).to.be.true
		})

		it("never offers the policy fix under Group Policy", () => {
			expect(shouldOffer(finding({ policyBlocked: true, policyGpoManaged: true }), "activation")).to.be.false
		})

		it("stays silent when healthy", () => {
			expect(shouldOffer(finding({}), "shell_integration_warning")).to.be.false
		})
	})

	describe("applyFixes", () => {
		it("sets the policy and verifies it took effect", async () => {
			let policy = "Restricted"
			const io = makeIo({
				getEffectivePolicy: async () => policy,
				setUserPolicyRemoteSigned: async () => {
					policy = "RemoteSigned"
				},
			})
			const result = await applyFixes(io, finding({ policyBlocked: true }))
			expect(result.ok).to.be.true
		})

		it("reports failure honestly when the policy did not change", async () => {
			const io = makeIo({ getEffectivePolicy: async () => "Restricted" })
			const result = await applyFixes(io, finding({ policyBlocked: true }))
			expect(result.ok).to.be.false
			expect(result.failure).to.contain("restricted")
		})

		it("sets PowerShell as default profile when misconfigured", async () => {
			const io = makeIo()
			await applyFixes(io, finding({ profileMisconfigured: true }))
			expect(io.calls).to.include("update:defaultProfile.windows=PowerShell")
		})

		it("re-enables shellIntegration.enabled when disabled", async () => {
			const io = makeIo()
			await applyFixes(io, finding({ shellIntegrationDisabled: true }))
			expect(io.calls).to.include("update:shellIntegration.enabled=true")
		})

		it("does not touch the policy under Group Policy", async () => {
			const io = makeIo()
			await applyFixes(io, finding({ policyBlocked: true, policyGpoManaged: true, profileMisconfigured: true }))
			expect(io.calls).to.not.include("setPolicy")
			expect(io.calls).to.include("update:defaultProfile.windows=PowerShell")
		})
	})

	describe("runShellIntegrationDoctor", () => {
		it("does nothing on non-Windows", async () => {
			const io = makeIo({ platform: "darwin" })
			await runShellIntegrationDoctor("activation", io)
			expect(io.calls).to.be.empty
		})

		it("auto-fixes policy + profile at activation with NO consent prompt, then restarts terminals", async () => {
			// The default setUserPolicyRemoteSigned records "setPolicy"; drive the effective policy
			// off that so the post-fix re-verification sees RemoteSigned.
			const calls: string[] = []
			const io = makeIo({
				calls,
				getEffectivePolicy: async () => (calls.includes("setPolicy") ? "RemoteSigned" : "Restricted"),
				getTerminalConfig: <T>(_key: string, defaultValue: T): T => defaultValue, // profile unset
			})
			await runShellIntegrationDoctor("activation", io)
			expect(io.calls).to.not.include("showWarning") // silent — no consent toast
			expect(io.calls).to.include("setPolicy")
			expect(io.calls).to.include("update:defaultProfile.windows=PowerShell")
			expect(io.calls).to.include("killAllTerminals")
			expect(io.calls).to.include("showInfo") // brief post-fix confirmation
		})

		it("shows guidance without a fix under Group Policy (the only unfixable case)", async () => {
			const io = makeIo({
				getEffectivePolicy: async () => "Restricted",
				getPolicyList: async () => ({ MachinePolicy: "Restricted" }),
			})
			await runShellIntegrationDoctor("activation", io)
			expect(io.calls).to.include("showWarning")
			expect(io.calls).to.not.include("setPolicy")
			expect(io.calls).to.not.include("killAllTerminals")
		})

		it("shows an honest error when the fix does not verify", async () => {
			const io = makeIo({
				getEffectivePolicy: async () => "Restricted", // never changes
			})
			await runShellIntegrationDoctor("activation", io)
			expect(io.calls).to.include("showError")
			expect(io.calls).to.not.include("killAllTerminals")
			expect(io.calls).to.not.include("showInfo")
		})

		it("acts at most once per session", async () => {
			const calls: string[] = []
			const io = makeIo({
				calls,
				getEffectivePolicy: async () => (calls.includes("setPolicy") ? "RemoteSigned" : "Restricted"),
			})
			await runShellIntegrationDoctor("activation", io)
			await runShellIntegrationDoctor("shell_integration_warning", io)
			expect(io.calls.filter((c) => c === "setPolicy")).to.have.length(1)
		})

		it("does not act on activation when only the profile is unset (waits for a real failure)", async () => {
			const io = makeIo({ getTerminalConfig: <T>(_key: string, defaultValue: T): T => defaultValue })
			await runShellIntegrationDoctor("activation", io)
			expect(io.calls).to.be.empty
		})

		it("auto-fixes a profile-only issue when a real failure fires, and can retry after a no-op activation", async () => {
			const io = makeIo({ getTerminalConfig: <T>(_key: string, defaultValue: T): T => defaultValue })
			// A no-op activation pass must NOT consume the once-per-session guard.
			await runShellIntegrationDoctor("activation", io)
			expect(io.calls).to.be.empty
			await runShellIntegrationDoctor("shell_integration_warning", io)
			expect(io.calls).to.include("update:defaultProfile.windows=PowerShell")
			expect(io.calls).to.include("showInfo")
		})
	})
})
