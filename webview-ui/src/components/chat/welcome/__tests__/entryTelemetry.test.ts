import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The counters exist to answer whether the cockpit helped. They must never be able to break it.
 *
 * Both failure modes are covered, because only one of them is obvious: a rejected promise is the
 * easy case, while a host that has no such route at all — an older extension, or a client stub
 * that never grew the method — throws synchronously inside render and white-screens the surface.
 */

const captureEntryEvent = vi.fn()
vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: { captureEntryEvent: (...a: unknown[]) => captureEntryEvent(...a) },
}))
vi.mock("@shared/proto/cline/state", () => ({ EntryEventRequest: { create: (x: unknown) => x } }))

const load = async () => {
	vi.resetModules()
	return await import("../entryTelemetry")
}

beforeEach(() => {
	captureEntryEvent.mockReset()
	captureEntryEvent.mockReturnValue(Promise.resolve())
})

describe("entry counters", () => {
	it("a paint is one measurement, carrying the shape it painted", async () => {
		const t = await load()
		t.entryShown({ mode: "collapsed", reason: "returning", hasResume: true, sessions: 4, newestAgeDays: 2.5, roots: 1 })
		expect(captureEntryEvent).toHaveBeenCalledTimes(1)
		const sent = captureEntryEvent.mock.calls[0][0] as { event: string; properties: Record<string, string> }
		expect(sent.event).toBe("entry_shown")
		expect(sent.properties.mode).toBe("collapsed")
		expect(sent.properties.sessions).toBe("4")
	})

	it("only the FIRST act of a paint counts as the first prompt", async () => {
		const t = await load()
		t.entryShown({ mode: "expanded", reason: "returning", hasResume: true, sessions: 0, newestAgeDays: 0, roots: 0 })
		captureEntryEvent.mockClear()
		t.entryFirstPrompt("card")
		t.entryFirstPrompt("typed")
		const firsts = captureEntryEvent.mock.calls.filter((c) => (c[0] as { event: string }).event === "entry_first_prompt")
		expect(firsts).toHaveLength(1)
		expect((firsts[0][0] as { properties: Record<string, string> }).properties.via).toBe("card")
	})

	it("a first prompt before any paint is not counted — there is no clock to measure against", async () => {
		const t = await load()
		t.entryFirstPrompt("typed")
		expect(captureEntryEvent).not.toHaveBeenCalled()
	})

	it("starting a run also claims the first prompt, so the two never disagree", async () => {
		const t = await load()
		t.entryShown({ mode: "expanded", reason: "returning", hasResume: true, sessions: 0, newestAgeDays: 0, roots: 1 })
		captureEntryEvent.mockClear()
		t.entryRunStart("lew840xGateway", "card")
		const events = captureEntryEvent.mock.calls.map((c) => (c[0] as { event: string }).event)
		expect(events).toContain("entry_first_prompt")
		expect(events).toContain("entry_build_start")
	})
})

describe("a counter never breaks the surface", () => {
	it("a rejected send is swallowed", async () => {
		const t = await load()
		captureEntryEvent.mockReturnValue(Promise.reject(new Error("telemetry off")))
		expect(() =>
			t.entryShown({ mode: "expanded", reason: "returning", hasResume: true, sessions: 0, newestAgeDays: 0, roots: 0 }),
		).not.toThrow()
	})

	it("a host with no such route at all is survivable — this is the one that white-screens", async () => {
		const t = await load()
		captureEntryEvent.mockImplementation(() => {
			throw new TypeError("captureEntryEvent is not a function")
		})
		expect(() =>
			t.entryShown({ mode: "expanded", reason: "returning", hasResume: true, sessions: 0, newestAgeDays: 0, roots: 0 }),
		).not.toThrow()
		expect(() => t.entryDrawerOpen(true)).not.toThrow()
	})
})
