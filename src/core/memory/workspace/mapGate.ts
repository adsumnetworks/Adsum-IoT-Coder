import { readMapMd, readSession } from "./store"

/**
 * Decide whether the workspace map joins the cached system prompt.
 *
 * WHY A GATE AT ALL: re-SENDING the map every turn is nearly free — it is inside the cached
 * prefix. Re-DECIDING mid-task is not: flipping it on at turn 8 rewrites ~46K tokens of cached
 * prompt, which costs far more than the map ever saves. So this is evaluated ONCE, at task start,
 * and the answer is held for the whole task.
 *
 * The signal comes from how the PREVIOUS task in this workspace behaved (written at task end),
 * which is the only honest predictor available before the current task has done anything.
 */

export const MAP_GATE_TURNS = 30
export const MAP_GATE_EXPLORATION_CALLS = 15
export const MAP_GATE_MAP_ENTRIES = 20

export interface MapGateInputs {
	previousTurns?: number
	previousExplorationCalls?: number
	appCount: number
	mapEntryCount: number
	/** No profile recorded yet ⇒ first task in this workspace. */
	firstTaskInWorkspace: boolean
}

export function shouldInjectMapFor(i: MapGateInputs): boolean {
	// Cold start is exactly when orientation costs most (measured: up to 17K tokens burned on
	// orientation in a single task), and there is no profile to consult. Always inject.
	if (i.firstTaskInWorkspace) {
		return true
	}
	if ((i.previousTurns ?? 0) > MAP_GATE_TURNS) {
		return true
	}
	if ((i.previousExplorationCalls ?? 0) >= MAP_GATE_EXPLORATION_CALLS) {
		return true
	}
	// A two-chip workspace (the gateway case) always pays for the map: the cross-chip contract
	// files are the ones the agent hunts for repeatedly.
	if (i.appCount >= 2) {
		return true
	}
	return i.mapEntryCount > MAP_GATE_MAP_ENTRIES
}

/** Rough entry count without parsing the map: its body is one file per line. */
function countMapEntries(mapMd: string): number {
	if (!mapMd) {
		return 0
	}
	return mapMd.split("\n").filter((l) => /^ {2}\S/.test(l)).length
}

/**
 * Disk-backed convenience wrapper. Fail-open: any error means "do not inject", because a missing
 * map is a small loss while a thrown error would take down the whole system prompt.
 */
export function shouldInjectMap(cwd: string | undefined, appCount = 0): boolean {
	try {
		const mapMd = readMapMd(cwd)
		if (!mapMd) {
			return false
		}
		const session = readSession(cwd)
		const profile = session.explorationProfile
		return shouldInjectMapFor({
			previousTurns: profile?.turns,
			previousExplorationCalls: profile?.explorationCalls,
			appCount,
			mapEntryCount: countMapEntries(mapMd),
			firstTaskInWorkspace: !profile,
		})
	} catch {
		return false
	}
}
