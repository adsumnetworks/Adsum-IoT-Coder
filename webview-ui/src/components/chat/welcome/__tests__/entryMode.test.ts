import { describe, expect, it } from "vitest"
import { type EntrySession, entryMode } from "../entryMode"

/**
 * The one rule of the entry surface.
 *
 * Expanded (the build cards are on screen) when the developer has fewer than two sessions, or
 * has been away more than 30 days. Collapsed otherwise: the input first, one named resume, and
 * everything else behind the drawer. The rule reads TOTAL history — a developer with five
 * sessions in another folder is not a beginner — while the resume is always scoped to the folder
 * the next session will belong to.
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0)

const session = (over: Partial<EntrySession> & { id: string; ageDays: number; cwd: string }): EntrySession => ({
	id: over.id,
	ts: NOW - over.ageDays * DAY,
	task: over.task ?? `task ${over.id}`,
	cwd: over.cwd,
	handoverId: over.handoverId,
})

const ROOT = "/w/gateway-fw"
const OTHER = "/w/sensor-fw"

describe("entryMode — expanded vs collapsed", () => {
	it("no history at all: expanded, nothing to resume", () => {
		const r = entryMode({ history: [], roots: [ROOT], scope: ROOT, now: NOW })
		expect(r.mode).toBe("expanded")
		expect(r.reason).toBe("no-history")
		expect(r.resume).toBeNull()
	})

	it("a single session is still expanded — one run is not a habit", () => {
		const r = entryMode({
			history: [session({ id: "a", ageDays: 0.1, cwd: ROOT })],
			roots: [ROOT],
			scope: ROOT,
			now: NOW,
		})
		expect(r.mode).toBe("expanded")
		expect(r.reason).toBe("one-session")
		expect(r.resume?.id).toBe("a")
	})

	it("two fresh sessions: collapsed, newest in scope is the resume", () => {
		const r = entryMode({
			history: [session({ id: "old", ageDays: 3, cwd: ROOT }), session({ id: "new", ageDays: 0.08, cwd: ROOT })],
			roots: [ROOT],
			scope: ROOT,
			now: NOW,
		})
		expect(r.mode).toBe("collapsed")
		expect(r.reason).toBe("returning")
		expect(r.resume?.id).toBe("new")
	})

	it("two sessions but the newest is 31 days old: expanded again", () => {
		const r = entryMode({
			history: [session({ id: "a", ageDays: 31, cwd: ROOT }), session({ id: "b", ageDays: 40, cwd: ROOT })],
			roots: [ROOT],
			scope: ROOT,
			now: NOW,
		})
		expect(r.mode).toBe("expanded")
		expect(r.reason).toBe("lapsed")
	})

	it("exactly 30 days is not yet lapsed — the boundary is strictly greater", () => {
		const r = entryMode({
			history: [session({ id: "a", ageDays: 30, cwd: ROOT }), session({ id: "b", ageDays: 44, cwd: ROOT })],
			roots: [ROOT],
			scope: ROOT,
			now: NOW,
		})
		expect(r.mode).toBe("collapsed")
	})

	it("the rule counts every folder — sessions elsewhere are not a beginner's", () => {
		// Total history decides the BEGINNER question: three runs in another folder mean this
		// developer knows what a session is, so "one-session" must not fire. Whether the surface
		// then collapses is a separate question, answered by whether there is a resume here.
		const r = entryMode({
			history: [
				session({ id: "a", ageDays: 1, cwd: OTHER }),
				session({ id: "b", ageDays: 2, cwd: OTHER }),
				session({ id: "here", ageDays: 3, cwd: ROOT }),
			],
			roots: [ROOT, OTHER],
			scope: ROOT,
			now: NOW,
		})
		expect(r.reason).toBe("returning")
		expect(r.mode).toBe("collapsed")
		expect(r.resume?.id).toBe("here")
		expect(r.elsewhereCount).toBe(2)
	})
})

describe("entryMode — nothing to collapse into", () => {
	it("plenty of history but none in THIS folder: expanded, because a collapse would show nothing", () => {
		const r = entryMode({
			history: [session({ id: "a", ageDays: 1, cwd: OTHER }), session({ id: "b", ageDays: 2, cwd: OTHER })],
			roots: [ROOT, OTHER],
			scope: ROOT,
			now: NOW,
		})
		expect(r.mode).toBe("expanded")
		expect(r.reason).toBe("no-resume-here")
		expect(r.resume).toBeNull()
		expect(r.elsewhereCount).toBe(2)
	})

	it("a resume in scope still collapses — the rule has not been widened by accident", () => {
		const r = entryMode({
			history: [session({ id: "a", ageDays: 1, cwd: ROOT }), session({ id: "b", ageDays: 2, cwd: OTHER })],
			roots: [ROOT, OTHER],
			scope: ROOT,
			now: NOW,
		})
		expect(r.mode).toBe("collapsed")
		expect(r.resume?.id).toBe("a")
	})
})

describe("entryMode — scope", () => {
	it("the resume is the newest session of the target folder, not of the window", () => {
		const r = entryMode({
			history: [
				session({ id: "newer-elsewhere", ageDays: 0.1, cwd: OTHER }),
				session({ id: "mine", ageDays: 2, cwd: ROOT }),
			],
			roots: [ROOT, OTHER],
			scope: ROOT,
			now: NOW,
		})
		expect(r.resume?.id).toBe("mine")
		expect(r.inScopeCount).toBe(1)
		expect(r.elsewhereCount).toBe(1)
	})

	it("retargeting the chip moves the resume with it", () => {
		const history = [session({ id: "gw", ageDays: 2, cwd: ROOT }), session({ id: "sensor", ageDays: 5, cwd: OTHER })]
		expect(entryMode({ history, roots: [ROOT, OTHER], scope: ROOT, now: NOW }).resume?.id).toBe("gw")
		expect(entryMode({ history, roots: [ROOT, OTHER], scope: OTHER, now: NOW }).resume?.id).toBe("sensor")
	})

	it("a session with no recorded folder belongs to no folder — never resumed by accident", () => {
		const orphan = { id: "orphan", ts: NOW - DAY, task: "old task", cwd: undefined }
		const r = entryMode({
			history: [orphan, session({ id: "b", ageDays: 4, cwd: OTHER })],
			roots: [ROOT],
			scope: ROOT,
			now: NOW,
		})
		expect(r.resume).toBeNull()
	})
})

describe("entryMode — the folder chip", () => {
	it("one folder open: no chip, the foot line carries the name", () => {
		expect(entryMode({ history: [], roots: [ROOT], scope: ROOT, now: NOW }).showChip).toBe(false)
	})

	it("more than one folder open: the chip appears", () => {
		expect(entryMode({ history: [], roots: [ROOT, OTHER], scope: ROOT, now: NOW }).showChip).toBe(true)
	})

	it("no folder open at all: no chip, and no scope to resume", () => {
		const r = entryMode({ history: [session({ id: "a", ageDays: 1, cwd: ROOT })], roots: [], scope: "", now: NOW })
		expect(r.showChip).toBe(false)
		expect(r.resume).toBeNull()
	})
})

describe("entryMode — handover rows", () => {
	it("a handover session resumes into the agent view, not a task", () => {
		const r = entryMode({
			history: [
				session({ id: "task", ageDays: 3, cwd: ROOT }),
				session({ id: "handed", ageDays: 0.2, cwd: ROOT, handoverId: "h-1" }),
			],
			roots: [ROOT],
			scope: ROOT,
			now: NOW,
		})
		expect(r.resume?.id).toBe("handed")
		expect(r.resumeKind).toBe("handover")
	})

	it("an ordinary session resumes as a task", () => {
		const r = entryMode({
			history: [session({ id: "a", ageDays: 1, cwd: ROOT }), session({ id: "b", ageDays: 2, cwd: ROOT })],
			roots: [ROOT],
			scope: ROOT,
			now: NOW,
		})
		expect(r.resumeKind).toBe("task")
	})
})

describe("entryMode — a clock that disagrees", () => {
	it("a session stamped in the future is treated as brand new, never as lapsed", () => {
		const r = entryMode({
			history: [
				{ id: "future", ts: NOW + 5 * DAY, task: "clock skew", cwd: ROOT },
				session({ id: "b", ageDays: 60, cwd: ROOT }),
			],
			roots: [ROOT],
			scope: ROOT,
			now: NOW,
		})
		expect(r.mode).toBe("collapsed")
		expect(r.newestAgeDays).toBe(0)
	})
})
