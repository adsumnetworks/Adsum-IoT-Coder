import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import CraNudge from "../CraNudge"

const EVIDENCE = "BLE detected · no SBOM in this project yet"

describe("CraNudge", () => {
	it("renders the grounded evidence line and the CRA framing", () => {
		render(<CraNudge evidence={EVIDENCE} onDismiss={vi.fn()} onPreview={vi.fn()} />)
		expect(screen.getByTestId("cra-nudge")).toBeInTheDocument()
		expect(screen.getByText(EVIDENCE)).toBeInTheDocument()
		expect(screen.getByText("Get ahead of the CRA")).toBeInTheDocument()
	})

	it("Preview fires onPreview", () => {
		const onPreview = vi.fn()
		render(<CraNudge evidence={EVIDENCE} onDismiss={vi.fn()} onPreview={onPreview} />)
		fireEvent.click(screen.getByTestId("cra-nudge-preview"))
		expect(onPreview).toHaveBeenCalledOnce()
	})

	it("dismiss fires onDismiss", () => {
		const onDismiss = vi.fn()
		render(<CraNudge evidence={EVIDENCE} onDismiss={onDismiss} onPreview={vi.fn()} />)
		fireEvent.click(screen.getByTestId("cra-nudge-dismiss"))
		expect(onDismiss).toHaveBeenCalledOnce()
	})

	it("evidence-mode: states detection + hedges the legal framing, never a conformity verdict", () => {
		const { container } = render(<CraNudge evidence={EVIDENCE} onDismiss={vi.fn()} onPreview={vi.fn()} />)
		const text = (container.textContent ?? "").toLowerCase()
		// Doctrine: the nudge must not assert a verdict…
		expect(text).not.toMatch(/\b(non-compliant|compliant|certified|conformant|passes)\b/)
		// …and must hedge the legal applicability rather than asserting it.
		expect(text).toContain("likely")
		expect(text).toContain("confirm your class")
	})
})
