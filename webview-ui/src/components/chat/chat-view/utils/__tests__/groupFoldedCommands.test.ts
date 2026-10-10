import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { groupFoldedCommands, isCommandFoldGroup } from "../messageUtils"

let ts = 0
const doneCommand = (text = "echo hi"): ClineMessage => ({ ts: ++ts, type: "say", say: "command", text, commandCompleted: true })
const liveCommand = (text = "echo hi"): ClineMessage => ({ ts: ++ts, type: "say", say: "command", text, commandCompleted: false })
const text = (s: string): ClineMessage => ({ ts: ++ts, type: "say", say: "text", text: s })

describe("groupFoldedCommands", () => {
	it("folds a single completed command into a one-item group", () => {
		const out = groupFoldedCommands([doneCommand()])
		expect(out).toHaveLength(1)
		expect(isCommandFoldGroup(out[0])).toBe(true)
		expect((out[0] as ClineMessage[]).length).toBe(1)
	})

	it("folds several consecutive completed commands into one group", () => {
		const out = groupFoldedCommands([doneCommand("a"), doneCommand("b"), doneCommand("c")])
		expect(out).toHaveLength(1)
		expect(isCommandFoldGroup(out[0])).toBe(true)
		expect((out[0] as ClineMessage[]).map((m) => m.text)).toEqual(["a", "b", "c"])
	})

	it("never folds a command that has not finished — it passes through untouched", () => {
		const live = liveCommand()
		const out = groupFoldedCommands([doneCommand("a"), live])
		expect(out).toHaveLength(2)
		expect(isCommandFoldGroup(out[0])).toBe(true)
		expect(out[1]).toBe(live)
	})

	it("leaves non-command messages untouched and breaks the run around them", () => {
		const t1 = text("hello")
		const out = groupFoldedCommands([doneCommand("a"), t1, doneCommand("b")])
		expect(out).toHaveLength(3)
		expect(isCommandFoldGroup(out[0])).toBe(true)
		expect(out[1]).toBe(t1)
		expect(isCommandFoldGroup(out[2])).toBe(true)
	})

	it("passes an already-grouped array (e.g. a tool group) through unchanged", () => {
		const group = [text("a")] as ClineMessage[] & { _isToolGroup: true }
		group._isToolGroup = true
		const out = groupFoldedCommands([group])
		expect(out).toEqual([group])
	})

	it("handles an empty list", () => {
		expect(groupFoldedCommands([])).toEqual([])
	})
})
