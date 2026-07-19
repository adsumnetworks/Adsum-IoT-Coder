import type { HandoverStrip } from "@shared/handover"
import { describe, expect, it } from "vitest"
import { routeDemo, routeTypedTask } from "../runRouting"

const strip = (over: Partial<HandoverStrip> = {}): HandoverStrip =>
	({
		id: "t1",
		phase: "working",
		mission: "Build, flash and debug softAP",
		calls: 3,
		startedAt: new Date().toISOString(),
		pickupPrompt: "Check the Adsum inbox…",
		baseline: { created: true, snapshots: 1 },
		packed: { bits: 12 },
		milestones: [],
		truncated: false,
		liveness: { state: "working", sinceSec: 5 },
		...over,
	}) as HandoverStrip

describe("routeTypedTask", () => {
	it("runs in Adsum when Adsum is the run target, session or not", () => {
		expect(routeTypedTask("adsum", null)).toEqual({ kind: "adsum" })
		expect(routeTypedTask("adsum", strip())).toEqual({ kind: "adsum" })
	})

	it("treats a typed line as a message when a session is live and reachable", () => {
		expect(routeTypedTask("agent", strip())).toEqual({ kind: "message-agent" })
		expect(routeTypedTask("agent", strip({ liveness: { state: "idle", sinceSec: 300 } }))).toEqual({
			kind: "message-agent",
		})
	})

	it("brings a stopped session home rather than queueing into a void", () => {
		// The field lost two messages this way: the composer promised delivery to an agent whose
		// process had already ended.
		expect(routeTypedTask("agent", strip({ liveness: { state: "stopped", sinceSec: 1800 } }))).toEqual({
			kind: "continue-here",
		})
	})

	it("treats a typed line as a new mission when nothing is live", () => {
		expect(routeTypedTask("agent", null)).toEqual({ kind: "hand-over" })
		expect(routeTypedTask("agent", undefined)).toEqual({ kind: "hand-over" })
	})

	it("does not send into a returned session — it is history, not a destination", () => {
		expect(routeTypedTask("agent", strip({ returned: true, phase: "closed" }))).toEqual({ kind: "hand-over" })
	})
})

describe("routeDemo", () => {
	it("hands an agent-runnable sample over instead of dead-clicking on our own factory guard", () => {
		// Regression: the sample click fell through to handleSendMessage → buildApiHandler → the
		// external-agent guard, which throws. The field reported the sample rows as "not clickable".
		expect(routeDemo("agent", true)).toEqual({ kind: "hand-over-demo" })
	})

	it("keeps a sample in Adsum when the agent cannot call what it needs", () => {
		expect(routeDemo("agent", false)).toEqual({ kind: "adsum" })
		expect(routeDemo("agent", undefined)).toEqual({ kind: "adsum" })
	})

	it("runs samples in Adsum when Adsum is the run target", () => {
		expect(routeDemo("adsum", true)).toEqual({ kind: "adsum" })
	})
})
