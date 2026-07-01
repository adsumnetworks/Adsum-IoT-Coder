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
	it("CRA-relevant → CRA readiness from the build, names the project", () => {
		const c = buildReengagementMessage({ craRelevant: true, projectName: "central_uart", version: "0.1.7" })
		expect(c.message).to.contain("central_uart")
		expect(c.message).to.contain("Cyber Resilience Act")
		expect(c.cta).to.equal("Show me")
	})

	it("not CRA-relevant → the shared 3-pillar what's-new pitch (never a false per-project CRA claim)", () => {
		const c = buildReengagementMessage({ craRelevant: false, version: "0.1.7" })
		expect(c.message).to.contain("What's new in v0.1.7")
		expect(c.message).to.contain("hardware-in-the-loop")
		expect(c.cta).to.equal("See what's new")
	})

	it("appends a free-token hint only when a positive balance is known (CRA-relevant copy)", () => {
		const withHint = buildReengagementMessage({
			craRelevant: true,
			projectName: "p",
			freeTokens: 2_000_000,
			version: "0.1.7",
		})
		expect(withHint.message).to.contain("2,000,000 free tokens")
		const noHint = buildReengagementMessage({ craRelevant: true, projectName: "p", freeTokens: 0, version: "0.1.7" })
		expect(noHint.message).to.not.contain("free tokens")
		const undefinedHint = buildReengagementMessage({ craRelevant: true, projectName: "p", version: "0.1.7" })
		expect(undefinedHint.message).to.not.contain("free tokens")
	})
})
