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

describe("entryMode — more than one folder open", () => {
	it("one folder open: nothing to say about it", () => {
		expect(entryMode({ history: [], roots: [ROOT], scope: ROOT, now: NOW }).multiRoot).toBe(false)
	})

	it("more than one folder open: the surface may say which one it picked", () => {
		expect(entryMode({ history: [], roots: [ROOT, OTHER], scope: ROOT, now: NOW }).multiRoot).toBe(true)
	})

	it("no folder open at all: nothing to say, and no scope to resume", () => {
		const r = entryMode({ history: [session({ id: "a", ageDays: 1, cwd: ROOT })], roots: [], scope: "", now: NOW })
		expect(r.multiRoot).toBe(false)
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

describe("the resume is found even when the folder is spelled two ways", () => {
	// [OPERATOR 2026-09-04] "why is resume previous session not showing here". The task stores the
	// path the host saw when it started; the window reports the path it sees now. They must agree
	// across the spellings a real machine produces, or every session is silently "elsewhere".
	const now = Date.now()
	const s = (cwd: string) => ({ id: "a", ts: now - 1000, task: "t", cwd })
	it("trailing slash", () => {
		expect(entryMode({ history: [s("/w/gw/"), s("/w/gw")], roots: ["/w/gw"], scope: "/w/gw", now }).inScopeCount).toBe(2)
	})
	it("macOS /private/tmp alias", () => {
		expect(entryMode({ history: [s("/private/tmp/x")], roots: ["/tmp/x"], scope: "/tmp/x", now }).resume).not.toBeNull()
	})
	it("Windows separators and drive-letter case", () => {
		expect(entryMode({ history: [s("c:\\\\w\\\\gw")], roots: ["C:/w/gw"], scope: "C:/w/gw", now }).resume).not.toBeNull()
	})
	it("but a different folder is still a different folder", () => {
		expect(entryMode({ history: [s("/w/gw2")], roots: ["/w/gw"], scope: "/w/gw", now }).resume).toBeNull()
	})
})
