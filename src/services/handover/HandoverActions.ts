/**
 * The seam between the webview's buttons and the host that can actually act.
 *
 * The controller is bundled into the standalone core and must stay runtime-free of vscode, but handing
 * a session over is inherently host work (modals, clipboard, terminals, the chat input). So the host
 * REGISTERS its implementations here at activation and the controller only ever calls through this
 * registry. On a host that never registers (the standalone core), the calls are honest no-ops rather
 * than a crash or a fake success.
 *
 * Each action is the SAME code path as its command-palette entry — the webview must never get a second,
 * subtly different version of the flow.
 */
export interface HandoverActions {
	/** Post the current session to the developer's coding agent. */
	handOver(): Promise<void>
	/** Bring a handed-over session back into Adsum, carrying what the agent did. */
	continueHere(): Promise<void>
	/** Open the full worklog of a handed-over session. */
	showWorklog(): Promise<void>
	/** Queue a message for the agent — delivered in the response to its next milestone. */
	messageAgent(text: string): Promise<void>
}

let registered: HandoverActions | null = null

export function registerHandoverActions(actions: HandoverActions): void {
	registered = actions
}

/** Null when the running host cannot hand over (e.g. the standalone core). */
export function getHandoverActions(): HandoverActions | null {
	return registered
}
