/**
 * A message sent to a task that is already working, waiting for its next turn boundary.
 *
 * Lives in shared/ because both sides need it: the host owns the queue (services/test/injectQueue.ts) and
 * the webview renders what is waiting, straight off ExtensionState. It travels inside `state_json`, so
 * there is no proto message for it.
 */

/** Which door a message came in by. The transcript labels them differently, and Stop only pulls back its own. */
export type NoteSource = "composer" | "seam"

export interface QueuedNote {
	id: string
	ts: number
	text: string
	images?: string[]
	files?: string[]
	source: NoteSource
	/** The driver name, for messages sent over the bench seam. The composer is the developer at the keyboard. */
	from?: string
}
