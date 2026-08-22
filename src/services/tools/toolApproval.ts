import type { ResolvedTool } from "./ToolResolver"

/**
 * Whether a tool bit may run without asking the developer.
 *
 * A downloaded tool is code from the registry executing with the developer's full privileges, so the
 * carve-out is deliberately narrow: a tool auto-approves only when it declares itself read-only,
 * claims no risky capability, and was verified on disk. Everything else asks — and four capabilities
 * can never auto-approve at all, because their consequences are not recoverable by undoing a file:
 * flashing or erasing a device, killing a process, or reaching the network.
 */
export const NEVER_AUTO_APPROVE: ReadonlySet<string> = new Set(["flash", "erase", "process-kill", "network"])

export interface ApprovalInput {
	readonly: boolean
	safety: string[]
	/** The resolver only returns tools whose bundle is verified, but the decision states it explicitly. */
	verified: boolean
	/** A tool the resolver could not fully validate is never auto-approved. */
	unavailable?: string
}

export function toolAutoApprovable(t: ApprovalInput): boolean {
	if (!t.verified || t.unavailable) {
		return false
	}
	if (!t.readonly) {
		return false
	}
	if (t.safety.some((s) => NEVER_AUTO_APPROVE.has(s))) {
		return false
	}
	// An empty safety list plus read-only is the only auto-approvable shape. `shell` alone still asks:
	// a read-only tool that shells out can still run an arbitrary command line.
	return t.safety.length === 0
}

/** The reason to show when a tool needs approval — plain, and specific about which capability. */
export function approvalReason(t: ApprovalInput): string | null {
	if (toolAutoApprovable(t)) {
		return null
	}
	if (t.unavailable) {
		return t.unavailable
	}
	if (!t.verified) {
		return "the tool's files could not be verified"
	}
	const risky = t.safety.filter((s) => NEVER_AUTO_APPROVE.has(s))
	if (risky.length) {
		return `this tool can ${risky.join(", ")}`
	}
	if (!t.readonly) {
		return "this tool writes to your machine"
	}
	return `this tool uses ${t.safety.join(", ")}`
}

export const approvalInputFor = (t: ResolvedTool): ApprovalInput => ({
	readonly: t.readonly,
	safety: t.safety,
	verified: true,
	unavailable: t.unavailable,
})
