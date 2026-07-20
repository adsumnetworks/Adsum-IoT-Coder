export type HistoryItem = {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	task: string
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
