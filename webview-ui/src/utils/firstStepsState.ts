import type { AdsumAccountState } from "@shared/adsumAccount"
import type { HistoryItem } from "@shared/HistoryItem"

export type FirstStepId = "sample" | "openProject" | "build" | "register" | "gateway"

export interface FirstStepsRow {
	id: FirstStepId
	done: boolean
}

export interface FirstStepsInput {
	/** Only the field each rule reads — a subset of HistoryItem so tests need no full fixtures. */
	taskHistory?: Pick<HistoryItem, "task">[]
	/** Every workspace folder open in this window — non-empty once a project is open. */
	openFolderPaths?: string[]
	adsumAccount?: AdsumAccountState | null
}

export interface FirstStepsResult {
	rows: FirstStepsRow[]
	/** The first undone row, or null once every row is done — the one row the "Show me" pill shows on. */
	nextId: FirstStepId | null
}

const SAMPLE_MARK = "[ADSUM_DEMO:"
const BUILD_WORDS = /\b(build|flash)\b/i
const GATEWAY_WORDS = /\b(blg20x?|lew840x?)\b/i

/** This order IS the ladder — the first undone row is always the one offered next. */
export const FIRST_STEPS_ORDER: FirstStepId[] = ["sample", "openProject", "build", "register", "gateway"]

/**
 * [0.5 sessions first] "First steps" done state, read from FACTS the host already reports — never from a
 * click flag on the card itself — so a developer who ran the sample from the palette, had a folder open
 * before this card ever rendered, or registered from a locked K-bit elsewhere sees the row struck
 * through immediately rather than being asked to repeat it here.
 */
export function firstStepsState(input: FirstStepsInput): FirstStepsResult {
	const history = input.taskHistory ?? []
	const taskContains = (re: RegExp | string) =>
		history.some((h) => (typeof re === "string" ? (h.task ?? "").includes(re) : re.test(h.task ?? "")))

	const done: Record<FirstStepId, boolean> = {
		sample: taskContains(SAMPLE_MARK),
		openProject: (input.openFolderPaths?.length ?? 0) > 0,
		build: taskContains(BUILD_WORDS),
		register: !!input.adsumAccount,
		gateway: taskContains(GATEWAY_WORDS),
	}

	const rows: FirstStepsRow[] = FIRST_STEPS_ORDER.map((id) => ({ id, done: done[id] }))
	const next = rows.find((r) => !r.done)
	return { rows, nextId: next?.id ?? null }
}
