/**
 * The contract between the host and the webview for a session handed to the developer's own coding
 * agent. Lives in shared/ because BOTH sides import it: the host builds it (services/handover/
 * HandoverUiState.ts), the webview renders it (components/chat/handover/).
 *
 * User-facing vocabulary note: the developer never sees "handover", "MCP", "brief" or "ledger" — the
 * concept is "your coding agent". These type names are internal.
 */

/** One row of the milestone worklog. The KIND carries the witness: `step` is what the agent REPORTED,
 *  `tool`/`host`/`snap` are what Adsum SAW. The UI must keep those visually distinct — a claim and an
 *  observation are not the same evidence, and merging them would be dishonest. */
export type MilestoneRow =
	/** ◆ a curated bit the agent loaded — carries its author's credit into the strip */
	| { kind: "bit"; t: string; title: string; author: string; version?: string }
	/** ✓ a milestone the AGENT reported (with the workflow step it says it completed) */
	| { kind: "step"; t: string; step?: string; text: string }
	/** ⚙ a toolchain command that ran THROUGH Adsum — host-witnessed */
	| { kind: "tool"; t: string; command: string; exit: number }
	/** ⇢ a working-tree change the host observed itself; needs no agent cooperation */
	| { kind: "host"; t: string; files: string[] }
	/** ⎘ a safety snapshot the host took */
	| { kind: "snap"; t: string }
	/** ◇ a drift nudge — derived from the ledger, not stored */
	| { kind: "nudge"; t: string; text: string }
	/** ✉ a message the developer typed for the agent. MCP cannot push, so it is DELIVERED in the
	 *  response to the agent's next milestone — `delivered: false` means still queued. */
	| { kind: "msg"; t: string; text: string; delivered: boolean }

export interface HandoverStrip {
	/** internal only — never rendered; the developer never sees a handover id */
	id: string
	phase: "posted" | "pickedUp" | "working" | "closed"
	mission: string
	calls: number
	startedAt: string
	closedAt?: string
	pickupPrompt: string
	baseline: { created: boolean; snapshots: number }
	packed: { bits: number; governing?: { title: string; author: string; version?: string } }
	/** newest LAST, capped */
	milestones: MilestoneRow[]
	/** true when older rows were dropped — the strip offers the full worklog */
	truncated: boolean
	/** What we actually know about the agent's presence — we cannot see its process, so this is derived
	 *  from call recency and never asserts more than that. Drives the header, the pulse, and whether the
	 *  composer offers to send at all (a message to a stopped agent would queue into a void). */
	liveness: { state: "never-picked-up" | "working" | "idle" | "stopped"; sinceSec: number }
	live?: { verb: string; sinceSec: number }
	/** Messages typed by the developer that the agent has not received yet, oldest first. */
	queued?: { text: string; ageSec: number }[]
	closing?: {
		headline: string
		/** what the agent SAYS it did */
		itSays: { files: string[]; nextStep?: string }
		/** what Adsum MEASURED — host-written observations only, never inferred from a claim */
		adsumSaw: { diffstat?: string; snapshots: number; buildsGreen: boolean }
		standingOn: { authors: string[]; steward?: string; bits: number }
	}
}

export interface HandoverUiState {
	/** Conductor mode = Adsum has no model of its own, so handing over IS the execution path. */
	conductor: { active: boolean; reason: string }
	/** Whether a coding agent we can auto-configure (Claude Code) is on this machine — drives the
	 *  external-agent settings panel's detection line and the auto-setup default. Host-resolved; the
	 *  webview never probes the filesystem. */
	agent?: { present: boolean; how?: string }
	strip: HandoverStrip | null
}
