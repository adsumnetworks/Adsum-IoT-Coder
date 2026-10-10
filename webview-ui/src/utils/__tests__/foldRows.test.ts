import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { foldRows, unfoldRows } from "../foldRows"

let tsCounter = 0
const tool = (toolName: string, extra: Record<string, unknown> = {}): ClineMessage => ({
	ts: ++tsCounter,
	type: "say",
	say: "tool",
	text: JSON.stringify({ tool: toolName, ...extra }),
})
const command = (text: string): ClineMessage => ({ ts: ++tsCounter, type: "say", say: "command", text })
const kbit = (title: string, author: string): ClineMessage => ({
	ts: ++tsCounter,
	type: "say",
	say: "kbit_loaded",
	text: JSON.stringify({ id: title.toLowerCase(), title, author, kind: "knowledge" }),
})
const ask = (askType: ClineMessage["ask"], text = ""): ClineMessage => ({ ts: ++tsCounter, type: "ask", ask: askType, text })
const error = (text = "boom"): ClineMessage => ({ ts: ++tsCounter, type: "say", say: "error", text })
const text = (s: string): ClineMessage => ({ ts: ++tsCounter, type: "say", say: "text", text: s })

describe("foldRows", () => {
	it("folds consecutive tool says into one worklog line", () => {
		const rows = foldRows([
			tool("readFile", { path: "a.ts" }),
			tool("readFile", { path: "b.ts" }),
			tool("readFile", { path: "c.ts" }),
		])
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ kind: "fold", category: "tool", label: "read 3 files" })
	})

	it("folds a single command into 'ran 1 command'", () => {
		const rows = foldRows([command("echo hi")])
		expect(rows[0]).toMatchObject({ kind: "fold", category: "command", label: "ran 1 command" })
	})

	it("folds multiple commands into 'ran N commands'", () => {
		const rows = foldRows([command("echo one"), command("echo two")])
		expect(rows[0]).toMatchObject({ kind: "fold", category: "command", label: "ran 2 commands" })
	})

	it("detects a flash command and names the board and version", () => {
		const rows = foldRows([command("nrfutil device program --firmware app.hex --core nrf9151 v0.3.3")])
		expect(rows[0]).toMatchObject({ kind: "fold", category: "command", label: "flashed nrf9151 v0.3.3" })
	})

	it("folds a single kbit_loaded using the existing credit-line convention", () => {
		const rows = foldRows([kbit("flash the nRF9151", "J. Steward")])
		expect(rows[0]).toMatchObject({
			kind: "fold",
			category: "kbit",
			label: "loaded ◆ flash the nRF9151, curated by J. Steward",
		})
	})

	it("groups several kbit_loaded says by their authors", () => {
		const rows = foldRows([kbit("bit one", "A"), kbit("bit two", "B")])
		expect(rows[0]).toMatchObject({ label: "loaded 2 bits, curated by A + B" })
	})

	it("never folds an ask — a tool awaiting approval stays on its own", () => {
		const rows = foldRows([tool("readFile"), ask("tool", "{}"), tool("readFile")])
		expect(rows.map((r) => r.kind)).toEqual(["fold", "single", "fold"])
		expect(rows[1]).toMatchObject({ kind: "single", message: { type: "ask" } })
	})

	it("never folds a question (followup ask)", () => {
		const rows = foldRows([tool("readFile"), ask("followup", "which board?")])
		expect(rows[1].kind).toBe("single")
	})

	it("never folds an error say", () => {
		const rows = foldRows([tool("readFile"), error("permission denied")])
		expect(rows[1]).toMatchObject({ kind: "single", message: { say: "error" } })
	})

	it("breaks the fold when the category changes (tool, then command, then tool again)", () => {
		const rows = foldRows([tool("readFile"), command("echo hi"), tool("readFile")])
		expect(rows.map((r) => (r.kind === "fold" ? r.category : "single"))).toEqual(["tool", "command", "tool"])
	})

	it("passes text and other unrelated says through untouched", () => {
		const rows = foldRows([text("hello"), tool("readFile"), text("done")])
		expect(rows[0]).toEqual({ kind: "single", message: expect.objectContaining({ say: "text" }) })
		expect(rows[2]).toEqual({ kind: "single", message: expect.objectContaining({ say: "text" }) })
	})

	it("never drops a message — the flattened output always matches the input, in order", () => {
		const input = [
			text("start"),
			tool("readFile"),
			tool("readFile"),
			ask("tool", "{}"),
			command("nrfutil device program nrf5340 v1.2.0"),
			error("oops"),
			kbit("a", "Author"),
			kbit("b", "Author2"),
			text("end"),
		]
		expect(unfoldRows(foldRows(input))).toEqual(input)
	})

	it("handles an empty transcript", () => {
		expect(foldRows([])).toEqual([])
	})
})
