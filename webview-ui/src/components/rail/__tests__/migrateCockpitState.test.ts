import { describe, expect, it } from "vitest"
import { migrateCockpitState } from "../RailView"

/** [0.5 sessions first] The cockpit's browser-state keys go once, on the rail's first mount, and never again. */
function fakeStorage(seed: Record<string, string>) {
	const map = new Map(Object.entries(seed))
	return {
		map,
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
	}
}

describe("migrateCockpitState", () => {
	it("removes the cockpit keys and marks the migration done", () => {
		const s = fakeStorage({
			"adsum.entry.seenRuns": "buildFlashDebug",
			"adsum.env.alwaysOpen": "1",
			"adsum.dockCoachMarkDismissed": "1",
			"adsum.palette.hintSeen": "1",
		})
		expect(migrateCockpitState(s)).toBe(true)
		expect(s.map.has("adsum.entry.seenRuns")).toBe(false)
		expect(s.map.has("adsum.env.alwaysOpen")).toBe(false)
		expect(s.map.has("adsum.dockCoachMarkDismissed")).toBe(false)
		// The rail's own keys are not the cockpit's.
		expect(s.map.get("adsum.palette.hintSeen")).toBe("1")
		expect(s.map.get("adsum.rail.migrated")).toBe("1")
	})

	it("is idempotent: a second mount does nothing", () => {
		const s = fakeStorage({ "adsum.rail.migrated": "1", "adsum.entry.seenRuns": "late" })
		expect(migrateCockpitState(s)).toBe(false)
		expect(s.map.get("adsum.entry.seenRuns")).toBe("late")
	})

	it("never throws when storage is unavailable", () => {
		const broken = {
			getItem: () => {
				throw new Error("blocked")
			},
			setItem: () => {},
			removeItem: () => {},
		}
		expect(migrateCockpitState(broken)).toBe(false)
	})
})
