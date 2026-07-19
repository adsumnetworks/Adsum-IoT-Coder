import type { HandoverStrip } from "@shared/handover"
import { describe, expect, it } from "vitest"
import { buildTurns } from "../turns"

/**
 * The regrouping is presentation LOGIC: a wrong attachment (evidence under the wrong turn, a nudge on
 * the wrong checkpoint) would misreport who did what when — so it is tested like logic, not looks.
 */

const T = (n: number) => new Date(Date.UTC(2026, 6, 19, 10, n)).toISOString()

const base = (over: Partial<HandoverStrip> = {}): HandoverStrip => ({
	id: "t1",
	phase: "working",
	mission: "Test and validate softAP",
	calls: 5,
	startedAt: T(0),
	pickupPrompt: "Check the Adsum inbox and pick up the session (t1).",
	baseline: { created: true, snapshots: 1 },
	packed: { bits: 14, governing: { title: "Test & Validate Workflow", author: "Omar Morceli" } },
	milestones: [],
	truncated: false,
	liveness: { state: "working", sinceSec: 5 },
	...over,
})

describe("buildTurns — milestones become a conversation", () => {
	it("opens with the mission, then Adsum's posted line", () => {
		const turns = buildTurns(base())
		expect(turns[0]).toMatchObject({ speaker: "you", text: "Test and validate softAP" })
		expect(turns[1]).toMatchObject({ speaker: "adsum", kind: "posted" })
		expect((turns[1] as any).text).toContain("14 knowledge bits")
		expect((turns[1] as any).text).toContain("safety snapshot created")
	})

	it("evidence accumulates under the checkpoint that follows it; credits show once per bit", () => {
		const turns = buildTurns(
			base({
				milestones: [
					{ kind: "bit", t: T(1), title: "Test & Validate Workflow", author: "Omar Morceli", version: "1.2.0" },
					{ kind: "tool", t: T(2), command: "idf.py --version", exit: 0 },
					{ kind: "step", t: T(3), step: "Step 2: Survey", text: "Survey done" },
					{ kind: "bit", t: T(4), title: "Test & Validate Workflow", author: "Omar Morceli", version: "1.2.0" },
					{ kind: "tool", t: T(5), command: "idf.py build", exit: 0 },
					{ kind: "step", t: T(6), step: "Step 4: Run", text: "Suite green" },
				],
			}),
		)
		const agentTurns = turns.filter((t) => t.speaker === "agent") as any[]
		expect(agentTurns).toHaveLength(2)
		expect(agentTurns[0].text).toBe("Survey done")
		expect(agentTurns[0].evidence.map((e: any) => e.command)).toEqual(["idf.py --version"])
		expect(agentTurns[0].credits).toEqual([{ title: "Test & Validate Workflow", author: "Omar Morceli", version: "1.2.0" }])
		// the SECOND load of the same bit stays silent — one credit line per session (the credit law)
		expect(agentTurns[1].credits).toEqual([])
		expect(agentTurns[1].evidence.map((e: any) => e.command)).toEqual(["idf.py build"])
	})

	it("a nudge attaches to the LAST agent turn, never the next one", () => {
		const turns = buildTurns(
			base({
				milestones: [
					{ kind: "step", t: T(2), step: "Step 4: Run", text: "extracted sta_table.h" },
					{ kind: "nudge", t: T(2), text: "nudged: edited source without building" },
					{ kind: "step", t: T(5), step: "Step 4: Run", text: "next milestone" },
				],
			}),
		)
		const agentTurns = turns.filter((t) => t.speaker === "agent") as any[]
		expect(agentTurns[0].nudges).toHaveLength(1)
		expect(agentTurns[1].nudges).toHaveLength(0)
	})

	it("a typed message is its own 'you' turn, marked queued until delivered", () => {
		const turns = buildTurns(
			base({
				milestones: [
					{ kind: "msg", t: T(2), text: "prefer pytest over unity", delivered: false },
					{ kind: "step", t: T(3), step: "Step 4: Run", text: "done" },
					{ kind: "msg", t: T(4), text: "ship it", delivered: true },
				],
			}),
		)
		const you = turns.filter((t) => t.speaker === "you") as any[]
		expect(you).toHaveLength(3) // mission + two messages
		expect(you[1]).toMatchObject({ text: "prefer pytest over unity", queued: true })
		expect(you[2]).toMatchObject({ text: "ship it", queued: false })
	})

	it("trailing evidence after the last checkpoint renders as work in flight, not lost", () => {
		const turns = buildTurns(
			base({
				milestones: [
					{ kind: "step", t: T(1), step: "Step 2: Survey", text: "done" },
					{ kind: "tool", t: T(2), command: "idf.py build", exit: 0 },
				],
			}),
		)
		const last = turns[turns.length - 1] as any
		expect(last.inProgress).toBe(true)
		expect(last.evidence.map((e: any) => e.command)).toEqual(["idf.py build"])
	})

	it("a closed session ends with Adsum's closing turn", () => {
		const turns = buildTurns(
			base({
				phase: "closed",
				closedAt: T(9),
				closing: {
					headline: "Suite green",
					itSays: { files: ["a.c"] },
					adsumSaw: { snapshots: 2, buildsGreen: true },
					standingOn: { authors: ["Omar Morceli"], bits: 2 },
				},
			}),
		)
		const last = turns[turns.length - 1] as any
		expect(last).toMatchObject({ speaker: "adsum", kind: "closed" })
	})
})
