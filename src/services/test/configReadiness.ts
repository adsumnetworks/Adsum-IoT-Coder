/**
 * The seam must not start a task on a configuration the developer did not choose (host issue H1).
 *
 * In a remote window the saved route lives on the client side. The extension host on the remote machine
 * starts on its own default, and the panel carries the saved route across when it initialises — on
 * 14 September that write arrived sixteen seconds into a task the seam had already started, so the first
 * three requests ran on the free tier. A person never meets this: they post from the panel, after it has
 * loaded. A driver posting through the seam can.
 *
 * So a POST /task in a remote window waits, for a bounded time, for the host to receive its first
 * configuration from the panel, and refuses with 409 if it does not arrive. A local window reads its
 * saved settings at activation and is never held.
 */

let firstConfigAt: number | null = null

/** Called by the settings write the panel sends. The first one marks the configuration as delivered. */
export function noteApiConfigurationReceived(now: number = Date.now()): void {
	firstConfigAt ??= now
}

/** When the panel first delivered a configuration to this host, or null. */
export function apiConfigurationReceivedAt(): number | null {
	return firstConfigAt
}

/** Test-only. */
export function __resetConfigReadiness(): void {
	firstConfigAt = null
}

/** How long a POST /task waits for the panel's configuration before refusing. */
export const CONFIG_WAIT_MS = 30_000

export type TaskGate = { verdict: "proceed" } | { verdict: "wait" } | { verdict: "refuse"; status: 409; error: string }

export function taskGate(f: {
	/** True in a remote window (the host's settings arrive from the client). */
	remote: boolean
	configReceivedAt: number | null
	waitedMs: number
	boundMs?: number
}): TaskGate {
	if (!f.remote || f.configReceivedAt !== null) {
		return { verdict: "proceed" }
	}
	if (f.waitedMs < (f.boundMs ?? CONFIG_WAIT_MS)) {
		return { verdict: "wait" }
	}
	return {
		verdict: "refuse",
		status: 409,
		error:
			"the panel has not delivered its saved provider settings to this host yet — a task started now would " +
			"run on the host's default provider. Make sure the panel is open and has loaded, then post again.",
	}
}
