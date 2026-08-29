/**
 * Who is driving this session, and may someone else take it?
 *
 * There is one extension host, one visible session and one fixed port, and until this existed a second
 * `POST /task` silently replaced whatever the first driver was doing. On 2026-08-29 that happened twice
 * inside an hour between two of my own tasks: once a watcher decided a PARKED run had finished and posted
 * over the top of it, costing a hardware test; once an older session woke up and started working against a
 * project path that had been moved under it. Neither driver was told anything.
 *
 * The lease does not lock anyone out — a driver that means it passes `takeover: true` and gets the
 * session. What it removes is the silence: a collision is now an answer with a name in it rather than a
 * session that quietly changed hands.
 *
 * Pure and in-memory on purpose. It is a courtesy between two people sharing a bench, not a security
 * boundary, and it must not outlive the extension host that holds the session it describes.
 */

import type { SessionState } from "./askBridge"

export interface Lease {
	driver: string
	taskId: string
	since: number
}

export type LeaseCheck =
	| { ok: true; reason: "free" | "same-driver" | "takeover" | "finished" }
	| { ok: false; status: 409; error: string; heldBy: string; taskId: string; state: SessionState }

/** A driven session is only "held" while it is doing something or waiting for someone. */
function isHeld(state: SessionState): boolean {
	return state === "running" || state === "awaiting_human"
}

/**
 * May `driver` start a new task right now?
 *
 * `complete` and `idle` release the lease implicitly: a finished run is not a run in progress, and holding
 * the session after `attempt_completion` would mean every driver had to remember to hand it back.
 */
export function checkClaim(lease: Lease | null, state: SessionState, driver: string | undefined, takeover: boolean): LeaseCheck {
	if (!lease || !isHeld(state)) {
		return { ok: true, reason: lease ? "finished" : "free" }
	}
	if (driver && driver === lease.driver) {
		// The same driver posting again is continuing their own work, not colliding with it.
		return { ok: true, reason: "same-driver" }
	}
	if (takeover) {
		return { ok: true, reason: "takeover" }
	}
	const held = lease.driver || "an unnamed driver"
	return {
		ok: false,
		status: 409,
		error:
			`This session is being driven by ${held} (task ${lease.taskId}, ${state.replace("_", " ")}). ` +
			`Posting now would replace their run without telling them. Pass {"takeover": true} if you mean to.`,
		heldBy: held,
		taskId: lease.taskId,
		state,
	}
}

export function claim(driver: string | undefined, taskId: string): Lease {
	return { driver: driver?.trim() || "an unnamed driver", taskId, since: Date.now() }
}
