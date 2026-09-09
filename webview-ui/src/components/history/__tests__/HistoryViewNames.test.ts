import { describe, expect, it } from "vitest"
import { withGivenNames } from "../HistoryView"

/**
 * The history RPC carries `task`, never `title`; the given name lives on extension state. Seen live
 * 2026-09-09: a rename was sent and stored, and the row repainted as the first prompt. The merge
 * is the fix, so it gets its own contract.
 */
describe("a session's given name reaches the history list", () => {
	const rpc = [
		{ id: "a", task: "Debug a real BLE NUS bug" },
		{ id: "b", task: "Bring up the gateway" },
	]

	it("takes the title from state by id, and leaves rows without one untouched", () => {
		const out = withGivenNames(rpc, [
			{ id: "a", title: "NUS central" },
			{ id: "zzz", title: "elsewhere" },
		])
		expect(out[0]).toMatchObject({ id: "a", task: "Debug a real BLE NUS bug", title: "NUS central" })
		expect(out[1]).toEqual(rpc[1])
	})

	it("an empty title in state is no name — the prompt stays the name", () => {
		const out = withGivenNames(rpc, [{ id: "a", title: "" }])
		expect((out[0] as any).title).toBeUndefined()
	})

	it("does not mutate what the RPC returned", () => {
		const before = JSON.stringify(rpc)
		withGivenNames(rpc, [{ id: "a", title: "x" }])
		expect(JSON.stringify(rpc)).toBe(before)
	})
})
