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
