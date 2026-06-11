import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildReengagementMessage,
	classifyReengagement,
	REENGAGEMENT_DORMANT_MS,
	REENGAGEMENT_MAX_IGNORES,
	REENGAGEMENT_MIN_INTERVAL_MS,
} from "../ReengagementNudge"

const NOW = 1_000_000_000_000
const DAY = 24 * 60 * 60 * 1000
const dormantTs = NOW - REENGAGEMENT_DORMANT_MS - DAY // comfortably past the dormancy threshold
const recentTs = NOW - DAY // active: 1 day ago

const demo = (ts: number) => ({
	task: "Debug a real BLE NUS bug — Central→Peripheral works, but Peripheral→Central is silently dropped.",
	ts,
})
const work = (ts: number) => ({ task: "Add a BLE battery service to my_app", ts })

describe("classifyReengagement", () => {
	it("brand-new install (no history) → null (install toast owns first-run)", () => {
		expect(classifyReengagement([], 0, 0, NOW)).to.equal(null)
		expect(classifyReengagement(undefined, 0, 0, NOW)).to.equal(null)
	})

	it("active user (recent task) → null, never nag", () => {
		expect(classifyReengagement([work(recentTs)], 0, 0, NOW)).to.equal(null)
	})

	it("dormant, demo-only → demo_no_work", () => {
		const d = classifyReengagement([demo(dormantTs)], 0, 0, NOW)
		expect(d?.cohort).to.equal("demo_no_work")
	})

	it("dormant, has real work → did_work (even if a demo also exists)", () => {
		expect(classifyReengagement([work(dormantTs)], 0, 0, NOW)?.cohort).to.equal("did_work")
		expect(classifyReengagement([demo(dormantTs), work(dormantTs)], 0, 0, NOW)?.cohort).to.equal("did_work")
	})

	it("dormancy measured from the MOST RECENT task", () => {
		// One old demo, but a recent real task ⇒ still active ⇒ null.
		expect(classifyReengagement([demo(dormantTs), work(recentTs)], 0, 0, NOW)).to.equal(null)
	})

	it("rate-limited inside the interval → null", () => {
		const lastShown = NOW - (REENGAGEMENT_MIN_INTERVAL_MS - 1)
		expect(classifyReengagement([work(dormantTs)], lastShown, 0, NOW)).to.equal(null)
	})

	it("interval elapsed → nudge again", () => {
		const lastShown = NOW - REENGAGEMENT_MIN_INTERVAL_MS
		expect(classifyReengagement([work(dormantTs)], lastShown, 0, NOW)?.cohort).to.equal("did_work")
	})

	it("decay: ignored up to the cap → stop (respect the no)", () => {
		expect(classifyReengagement([work(dormantTs)], 0, REENGAGEMENT_MAX_IGNORES, NOW)).to.equal(null)
		expect(classifyReengagement([work(dormantTs)], 0, REENGAGEMENT_MAX_IGNORES - 1, NOW)?.cohort).to.equal("did_work")
	})

	it("reports days dormant", () => {
		const d = classifyReengagement([work(NOW - 10 * DAY)], 0, 0, NOW)
		expect(d?.daysDormant).to.equal(10)
	})

	it("test-mode thresholds collapse the time gates", () => {
		// Recent task + just nudged + many ignores would normally be null; zeroed thresholds + infinite
		// ignore cap ⇒ shows.
		const d = classifyReengagement([demo(recentTs)], NOW, 99, NOW, {
			dormantMs: 0,
			intervalMs: 0,
			maxIgnores: Number.POSITIVE_INFINITY,
		})
		expect(d?.cohort).to.equal("demo_no_work")
	})
})

describe("buildReengagementMessage", () => {
	it("demo_no_work with a project names it and offers to debug firmware", () => {
		const c = buildReengagementMessage("demo_no_work", { hasProject: true, projectName: "central_uart" })
		expect(c.message).to.contain("central_uart")
		expect(c.cta).to.equal("Debug my firmware")
	})

	it("demo_no_work without a project invites opening one", () => {
		const c = buildReengagementMessage("demo_no_work", { hasProject: false })
		expect(c.cta).to.equal("Open my project")
	})

	it("did_work with a project offers to resume it", () => {
		const c = buildReengagementMessage("did_work", { hasProject: true, projectName: "my_app" })
		expect(c.message).to.contain("my_app")
		expect(c.cta).to.equal("Resume")
	})

	it("appends a free-token hint only when a positive balance is known", () => {
		const withHint = buildReengagementMessage("did_work", { hasProject: true, projectName: "p", freeTokens: 2_000_000 })
		expect(withHint.message).to.contain("2,000,000 free tokens")
		const noHint = buildReengagementMessage("did_work", { hasProject: true, projectName: "p", freeTokens: 0 })
		expect(noHint.message).to.not.contain("free tokens")
		const undefinedHint = buildReengagementMessage("did_work", { hasProject: true, projectName: "p" })
		expect(undefinedHint.message).to.not.contain("free tokens")
	})
})
