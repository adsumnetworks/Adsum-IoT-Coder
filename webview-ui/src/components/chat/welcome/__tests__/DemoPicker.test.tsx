import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DEMO_SCENARIO_LIST } from "../../demoScenarios"
import DemoPicker from "../DemoPicker"

describe("DemoPicker", () => {
	it("hero: renders the picker heading and one row per registered scenario", () => {
		render(<DemoPicker onStartDemo={vi.fn()} />)
		expect(screen.getByText("Try it on a sample")).toBeInTheDocument()
		for (const s of DEMO_SCENARIO_LIST) {
			expect(screen.getByTestId(`demo-scenario-${s.id}`)).toBeInTheDocument()
			expect(screen.getByText(s.title)).toBeInTheDocument()
		}
	})

	it("hero: shows each scenario's honest label and platform badge (nRF, properly cased)", () => {
		render(<DemoPicker onStartDemo={vi.fn()} />)
		for (const s of DEMO_SCENARIO_LIST) {
			expect(screen.getByText(s.honestLabel)).toBeInTheDocument()
		}
		// Platform badge is the properly-cased "nRF" (A1: was lowercase "nrf").
		expect(screen.getAllByText("nRF").length).toBeGreaterThanOrEqual(1)
		expect(screen.queryByText("nrf")).not.toBeInTheDocument()
	})

	it("shows a 'New' badge on the CRA + Omar (isNew) sample rows", () => {
		render(<DemoPicker onStartDemo={vi.fn()} />)
		const newCount = DEMO_SCENARIO_LIST.filter((s) => s.isNew).length
		expect(newCount).toBeGreaterThanOrEqual(1)
		expect(screen.getAllByText("New").length).toBe(newCount)
	})

	it("a 'coming soon' placeholder row is disabled, shows 'soon', and never fires onStartDemo (A9 — Omar wires it later)", () => {
		const onStartDemo = vi.fn()
		render(<DemoPicker onStartDemo={onStartDemo} />)
		const placeholder = DEMO_SCENARIO_LIST.find((s) => s.comingSoon)
		expect(placeholder, "expected a comingSoon placeholder scenario").toBeTruthy()
		const row = screen.getByTestId(`demo-scenario-${placeholder?.id}`) as HTMLButtonElement
		expect(row.disabled).toBe(true)
		expect(screen.getByText("soon")).toBeInTheDocument()
		fireEvent.click(row)
		expect(onStartDemo).not.toHaveBeenCalled()
	})

	it("clicking a runnable scenario row fires onStartDemo with that scenario id", () => {
		const onStartDemo = vi.fn()
		render(<DemoPicker onStartDemo={onStartDemo} />)
		fireEvent.click(screen.getByTestId("demo-scenario-cra-sample"))
		expect(onStartDemo).toHaveBeenCalledWith("cra-sample")
		fireEvent.click(screen.getByTestId("demo-scenario-nus-uart"))
		expect(onStartDemo).toHaveBeenCalledWith("nus-uart")
	})

	it("rerun: quiet heading, rows still present, honest labels hidden", () => {
		render(<DemoPicker onStartDemo={vi.fn()} variant="rerun" />)
		expect(screen.getByText("Try another sample")).toBeInTheDocument()
		expect(screen.queryByText("Try it on a sample")).not.toBeInTheDocument()
		for (const s of DEMO_SCENARIO_LIST) {
			expect(screen.getByTestId(`demo-scenario-${s.id}`)).toBeInTheDocument()
			expect(screen.queryByText(s.honestLabel)).not.toBeInTheDocument()
		}
	})

	it("disabled: rows are disabled and do not fire onStartDemo", () => {
		const onStartDemo = vi.fn()
		render(<DemoPicker disabled onStartDemo={onStartDemo} />)
		const row = screen.getByTestId("demo-scenario-nus-uart") as HTMLButtonElement
		expect(row.disabled).toBe(true)
		fireEvent.click(row)
		expect(onStartDemo).not.toHaveBeenCalled()
	})
})
