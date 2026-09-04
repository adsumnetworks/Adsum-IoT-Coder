/**
 * The one rule of the entry surface.
 *
 * A developer who has run one session is still learning what a session IS, so the build cards
 * stay on screen. A developer who has run several and was here this morning wants the input and
 * one resume, and everything else out of the way. Somebody returning after a month is closer to
 * the first than the second — the cards come back rather than making them remember.
 *
 * That is the whole rule: **expanded when fewer than two sessions, or the newest is older than
 * 30 days; collapsed otherwise.** It reads TOTAL history, because five sessions in another folder
 * do not make someone a beginner — while the RESUME is always scoped to the folder the next
 * session will belong to, because that is the one they are about to work in.
 *
 * Kept as a pure function with no React and no host calls so the states can be tested directly:
 * the alternative is a component that only reveals its rule by being rendered.
 */

/** Days before a returning developer is treated as new again. Not measured — a judgement, and the
 *  first thing to revisit when the entry counters have a fortnight of data behind them. */
export const LAPSED_AFTER_DAYS = 30

/** Sessions below which the cards stay on screen. One run is not yet a habit. */
export const HABIT_AT_SESSIONS = 2

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** The part of a history row this rule needs. A subset of HistoryItem so tests need no fixtures
 *  of fields the rule never reads. */
export interface EntrySession {
	id: string
	/** Epoch ms the task started. */
	ts: number
	task: string
	/** The workspace folder the task was started in — `HistoryItem.cwdOnTaskInitialization`.
	 *  Undefined on rows old enough to predate that field: such a row belongs to no folder and is
	 *  never resumed by accident. */
	cwd?: string
	/** Present ⇒ the developer's own agent ran this via handover; resuming opens the agent view,
	 *  not a task. */
	handoverId?: string
}

export interface EntryInput {
	history: EntrySession[]
	/** Every workspace folder open in this window. */
	roots: string[]
	/** The folder the next session belongs to — one of `roots`, or "" when none is open. */
	scope: string
	now: number
}

export interface EntryMode {
	mode: "expanded" | "collapsed"
	/** Why, so the UI can say it and a test can assert on it rather than on the boolean. */
	reason: "no-history" | "one-session" | "lapsed" | "returning"
	/** The newest session in scope, or null — the single named action the collapsed state offers. */
	resume: EntrySession | null
	resumeKind: "task" | "handover" | null
	inScopeCount: number
	elsewhereCount: number
	/** Age of the newest session anywhere, in days. 0 when there is none. */
	newestAgeDays: number
	/** The folder chip exists only when there is more than one folder to choose between. A chip in
	 *  a single-folder window is a control that cannot act. */
	showChip: boolean
}

const ageInDays = (ts: number, now: number): number => {
	// A row stamped in the future is clock skew, not a session from tomorrow. Clamp at 0 so it
	// reads as brand new rather than making the whole window look lapsed.
	const ms = now - ts
	return ms <= 0 ? 0 : ms / MS_PER_DAY
}

export function entryMode({ history, roots, scope, now }: EntryInput): EntryMode {
	const inScope = scope ? history.filter((s) => s.cwd === scope) : []
	const elsewhere = history.length - inScope.length

	const newest = history.reduce<EntrySession | null>((best, s) => (!best || s.ts > best.ts ? s : best), null)
	const newestAgeDays = newest ? ageInDays(newest.ts, now) : 0

	const resume = inScope.reduce<EntrySession | null>((best, s) => (!best || s.ts > best.ts ? s : best), null)

	let mode: EntryMode["mode"]
	let reason: EntryMode["reason"]
	if (history.length === 0) {
		mode = "expanded"
		reason = "no-history"
	} else if (history.length < HABIT_AT_SESSIONS) {
		mode = "expanded"
		reason = "one-session"
	} else if (newestAgeDays > LAPSED_AFTER_DAYS) {
		mode = "expanded"
		reason = "lapsed"
	} else {
		mode = "collapsed"
		reason = "returning"
	}

	return {
		mode,
		reason,
		resume,
		resumeKind: resume ? (resume.handoverId ? "handover" : "task") : null,
		inScopeCount: inScope.length,
		elsewhereCount: elsewhere,
		newestAgeDays,
		showChip: roots.length > 1,
	}
}
