export type HistoryItem = {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	task: string
	/** A name the developer gave the session. Display only — `task` stays the first prompt, which is
	 *  what the model saw and what search still matches. [OPERATOR 2026-09-04] "rename the sessions":
	 *  a session titled by its first prompt ("xcxc", "dsdsd") is not a title anyone can find again. */
	title?: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number

	size?: number
	/** Present ⇒ this row is a session your own coding agent worked via handover, not an Adsum task.
	 *  There is no task directory behind it: opening routes to the agent session view (read from
	 *  ~/.adsum/handovers/<id>), token/cost fields stay 0 and are not rendered — Adsum never ran those
	 *  tokens, so showing $0.00 would claim a price for work it didn't do. Deleting the row deletes the
	 *  handover directory. */
	handoverId?: string
	shadowGitConfigWorkTree?: string
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean
	checkpointManagerErrorMessage?: string

	modelId?: string
}
