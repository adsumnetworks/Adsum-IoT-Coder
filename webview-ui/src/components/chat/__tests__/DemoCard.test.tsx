import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import DemoCard from "../DemoCard"
import { DEFAULT_DEMO_SCENARIO_ID, DEMO_SCENARIOS } from "../demoScenarios"

const scenario = DEMO_SCENARIOS[DEFAULT_DEMO_SCENARIO_ID]

describe("DemoCard — hero variant (default)", () => {
	let onStartDemo: ReturnType<typeof vi.fn>

	beforeEach(() => {
		onStartDemo = vi.fn()
	})

	it("renders the prominent hero copy", () => {
		render(<DemoCard onStartDemo={onStartDemo} />)
		expect(screen.getByText("See it debug a real bug")).toBeInTheDocument()
		expect(screen.getByText(`${scenario.title} — no setup, no hardware needed`)).toBeInTheDocument()
		expect(screen.getByText(scenario.honestLabel)).toBeInTheDocument()
	})

	it("uses the rocket icon", () => {
		const { container } = render(<DemoCard onStartDemo={onStartDemo} />)
		expect(container.querySelector(".codicon-rocket")).toBeTruthy()
		expect(container.querySelector(".codicon-refresh")).toBeFalsy()
	})

	it("starts the default scenario on click", () => {
		render(<DemoCard onStartDemo={onStartDemo} />)
		fireEvent.click(screen.getByTestId("demo-card-button"))
		expect(onStartDemo).toHaveBeenCalledWith(DEFAULT_DEMO_SCENARIO_ID)
	})

	it("does not fire when disabled", () => {
		render(<DemoCard disabled onStartDemo={onStartDemo} />)
		fireEvent.click(screen.getByTestId("demo-card-button"))
		expect(onStartDemo).not.toHaveBeenCalled()
	})
})

describe("DemoCard — rerun variant (demoted, abridged)", () => {
	let onStartDemo: ReturnType<typeof vi.fn>

	beforeEach(() => {
		onStartDemo = vi.fn()
	})

	it("renders the abridged title only", () => {
		render(<DemoCard onStartDemo={onStartDemo} variant="rerun" />)
		expect(screen.getByText("Re-run demo")).toBeInTheDocument()
	})

	it("drops the hero copy, subtitle, and honest label", () => {
		render(<DemoCard onStartDemo={onStartDemo} variant="rerun" />)
		expect(screen.queryByText("See it debug a real bug")).not.toBeInTheDocument()
		expect(screen.queryByText(`${scenario.title} — no setup, no hardware needed`)).not.toBeInTheDocument()
		expect(screen.queryByText(scenario.honestLabel)).not.toBeInTheDocument()
	})

	it("uses the refresh icon, not the rocket (regression: no orange hero icon)", () => {
		const { container } = render(<DemoCard onStartDemo={onStartDemo} variant="rerun" />)
		expect(container.querySelector(".codicon-refresh")).toBeTruthy()
		expect(container.querySelector(".codicon-rocket")).toBeFalsy()
	})

	it("still restarts the demo on click", () => {
		render(<DemoCard onStartDemo={onStartDemo} variant="rerun" />)
		fireEvent.click(screen.getByTestId("demo-card-button"))
		expect(onStartDemo).toHaveBeenCalledWith(DEFAULT_DEMO_SCENARIO_ID)
	})
})
