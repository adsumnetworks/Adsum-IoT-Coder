import type { ClineMessage } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import CraProgressRail, { parseCraProgress } from "../CraProgressRail"

const say = (text: string): ClineMessage => ({ ts: 1, type: "say", say: "text", text })
const done = (): ClineMessage => ({ ts: 2, type: "say", say: "completion_result", text: "preview complete" })

describe("parseCraProgress", () => {
	it("returns null when there is no CRA run (no step banner) — the rail self-hides", () => {
		expect(parseCraProgress([say("just a normal chat message"), say("### Heading, not a step")])).toBeNull()
	})

	it("tracks the highest step banner seen", () => {
		const msgs = [
			say("### Step 1/5 · Inventory your build (SBOM)"),
			say("some output"),
			say("### Step 2/5 · Scan for known vulnerabilities"),
		]
		expect(parseCraProgress(msgs)).toEqual({ current: 2, done: false })
	})

	it("tolerant of banner formatting (no #, extra spaces)", () => {
		expect(parseCraProgress([say("Step 3 / 5 · Read the posture")])).toEqual({ current: 3, done: false })
	})

	it("marks done only when step 5 reached AND a completion message exists", () => {
		expect(parseCraProgress([say("### Step 5/5 · One concrete next step")])).toEqual({ current: 5, done: false })
		expect(parseCraProgress([say("### Step 5/5 · One concrete next step"), done()])).toEqual({ current: 5, done: true })
	})

	it("does not mark done at completion if step 5 was never reached", () => {
		expect(parseCraProgress([say("### Step 2/5 · Scan"), done()])).toEqual({ current: 2, done: false })
	})
})

describe("CraProgressRail", () => {
	it("renders nothing outside a CRA run", () => {
		const { container } = render(<CraProgressRail messages={[say("hello")]} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders the rail with the active step's plain-English caption (the 'not stuck' line)", () => {
		render(<CraProgressRail messages={[say("### Step 2/5 · Scan for known vulnerabilities")]} />)
		expect(screen.getByTestId("cra-progress-rail")).toBeInTheDocument()
		expect(screen.getByText(/Step 2\/5 · Scan CVEs/)).toBeInTheDocument()
		expect(screen.getByText(/~10–30s/)).toBeInTheDocument()
	})

	it("shows the complete caption (counts/verdict-free) when the run finishes", () => {
		render(<CraProgressRail messages={[say("### Step 5/5 · One concrete next step"), done()]} />)
		expect(screen.getByText(/CRA preview complete/)).toBeInTheDocument()
	})
})

describe("CraProgressRail — real-project remediation loop", () => {
	it("parses the remediation loop banner (gap N of M + name + history)", () => {
		const p = parseCraProgress([
			say("### Step 4/5 · Triage"),
			say("### Step 5/5 · Remediate — gap 1 of 4 · secure boot"),
			say("### Step 5/5 · Remediate — gap 2 of 4 · signed FOTA"),
		])
		expect(p?.current).toBe(5)
		expect(p?.done).toBe(false)
		expect(p?.remediation).toEqual({
			gap: 2,
			total: 4,
			currentName: "signed FOTA",
			history: [
				{ gap: 1, name: "secure boot" },
				{ gap: 2, name: "signed FOTA" },
			],
		})
	})

	it("renders step 5 as a spinning loop node + the gap caption + iteration list (not 'done')", () => {
		render(<CraProgressRail messages={[say("### Step 5/5 · Remediate — gap 2 of 4 · signed FOTA")]} />)
		expect(screen.getByTestId("cra-loop-node")).toBeInTheDocument()
		expect(screen.getByText(/Remediate — gap 2 of 4 · signed FOTA/)).toBeInTheDocument()
		expect(screen.getByText(/more gap.*pending/)).toBeInTheDocument()
	})

	it("loop only reaches 'done' at a real exit (completion_result)", () => {
		const a = parseCraProgress([say("### Step 5/5 · Remediate — gap 2 of 4 · signed FOTA")])
		expect(a?.done).toBe(false)
		const b = parseCraProgress([say("### Step 5/5 · Remediate — gap 2 of 4 · signed FOTA"), done()])
		expect(b?.done).toBe(true)
	})

	it("the SAMPLE preview step-5 is unchanged (no loop node, linear 'Next')", () => {
		render(<CraProgressRail messages={[say("### Step 5/5 · One concrete next step")]} />)
		expect(screen.queryByTestId("cra-loop-node")).toBeNull()
		expect(screen.getByText(/Step 5\/5 · Next/)).toBeInTheDocument()
		expect(screen.getByText(/highest-value thing to do next/)).toBeInTheDocument()
	})
})
