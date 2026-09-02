import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import CraStepMarker, { parseStepHeading } from "../CraStepMarker"

describe("parseStepHeading", () => {
	it("matches a CRA step banner and extracts step + title", () => {
		expect(parseStepHeading("Step 2/5 · Scan for known vulnerabilities")).toEqual({
			step: 2,
			total: 5,
			title: "Scan for known vulnerabilities",
		})
	})

	it("tolerates spacing and separators", () => {
		expect(parseStepHeading("  Step 3 / 5 - Read the posture ")).toEqual({
			step: 3,
			total: 5,
			title: "Read the posture",
		})
	})

	it("returns null for ordinary headings (so they stay normal headings)", () => {
		expect(parseStepHeading("CRA SBOM & Fix")).toBeNull()
		expect(parseStepHeading("Step into the future")).toBeNull()
		expect(parseStepHeading("Step 9/5 · out of range")).toBeNull()
	})

	it("falls back to the canonical label when the title is empty", () => {
		expect(parseStepHeading("Step 1/5")).toEqual({ step: 1, total: 5, title: "Inventory" })
	})

	// A guided product build runs seven beats. Before N/M these fell through to a plain h3.
	it("accepts any total from 2..12, not just the CRA five", () => {
		expect(parseStepHeading("Step 4/7 · The application")).toEqual({
			step: 4,
			total: 7,
			title: "The application",
		})
		expect(parseStepHeading("Step 1/2 · Halves")).toEqual({ step: 1, total: 2, title: "Halves" })
		expect(parseStepHeading("Step 12/12 · Last")).toEqual({ step: 12, total: 12, title: "Last" })
	})

	it("rejects a nonsense counter rather than rendering a broken banner", () => {
		expect(parseStepHeading("Step 1/1 · not a sequence")).toBeNull()
		expect(parseStepHeading("Step 3/13 · too many")).toBeNull()
		expect(parseStepHeading("Step 8/7 · past the end")).toBeNull()
	})

	// The CRA default titles belong to the 5-step flow only; a 7-step banner has none to borrow.
	it("borrows a canonical title ONLY at total === 5", () => {
		expect(parseStepHeading("Step 1/7")).toEqual({ step: 1, total: 7, title: "" })
	})

	it("DEFENSIVE: a dumped wall of bit text is NOT treated as a banner (no giant marker)", () => {
		const dump =
			'Step 5/5 · Remediate — gap 2 of 4 · signed FOTA`. This keeps the rail showing a LOOP (not "done") across iterations — it only reads complete at a real loop exit. Align the to-do list to these SAME five steps…'
		expect(parseStepHeading(dump)).toBeNull()
		// a multi-line blob is also rejected
		expect(parseStepHeading("Step 5/5 · Remediate — gap 2 of 4\nThen a second line of dumped instructions")).toBeNull()
	})
})

describe("CraStepMarker", () => {
	it("renders the step chip, big title, and a /5 counter", () => {
		render(<CraStepMarker step={3} title="Read the posture" />)
		expect(screen.getByTestId("cra-step-marker")).toBeInTheDocument()
		expect(screen.getByText("Read the posture")).toBeInTheDocument()
		expect(screen.getByText("3/5")).toBeInTheDocument()
	})

	// BACKWARD COMPATIBILITY: total is optional and defaults to the CRA five, so every existing
	// call site and every `Step N/5` banner renders exactly as it did before N/M was introduced.
	it("renders a /5 banner identically whether or not total is passed", () => {
		const { container: withoutTotal } = render(<CraStepMarker step={3} title="Read the posture" />)
		const before = withoutTotal.innerHTML
		const { container: withTotal } = render(<CraStepMarker step={3} title="Read the posture" total={5} />)
		expect(withTotal.innerHTML).toBe(before)
	})

	it("renders the real denominator for a longer flow", () => {
		render(<CraStepMarker step={4} title="The application" total={7} />)
		expect(screen.getByText("4/7")).toBeInTheDocument()
		expect(screen.getByLabelText("Step 4 of 7: The application")).toBeInTheDocument()
	})
})
