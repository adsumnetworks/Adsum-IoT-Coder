import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import CraStepMarker, { parseStepHeading } from "../CraStepMarker"

describe("parseStepHeading", () => {
	it("matches a CRA step banner and extracts step + title", () => {
		expect(parseStepHeading("Step 2/5 · Scan for known vulnerabilities")).toEqual({
			step: 2,
			title: "Scan for known vulnerabilities",
		})
	})

	it("tolerates spacing and separators", () => {
		expect(parseStepHeading("  Step 3 / 5 - Read the posture ")).toEqual({ step: 3, title: "Read the posture" })
	})

	it("returns null for ordinary headings (so they stay normal headings)", () => {
		expect(parseStepHeading("CRA SBOM & Fix")).toBeNull()
		expect(parseStepHeading("Step into the future")).toBeNull()
		expect(parseStepHeading("Step 9/5 · out of range")).toBeNull()
	})

	it("falls back to the canonical label when the title is empty", () => {
		expect(parseStepHeading("Step 1/5")).toEqual({ step: 1, title: "Inventory" })
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
})
