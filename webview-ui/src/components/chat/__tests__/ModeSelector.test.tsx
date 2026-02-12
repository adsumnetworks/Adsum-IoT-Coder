import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ModeSelector from "../ModeSelector"

describe("ModeSelector", () => {
	it("renders both mode buttons", () => {
		render(<ModeSelector onModeSelect={() => {}} />)

		expect(screen.getByTestId("mode-button-log_generator")).toBeDefined()
		expect(screen.getByTestId("mode-button-log_analyzer")).toBeDefined()
	})

	it("renders title and description for each mode", () => {
		render(<ModeSelector onModeSelect={() => {}} />)

		expect(screen.getByText("Generate Logging Code")).toBeDefined()
		expect(screen.getByText("Add LOG_* macros to your C files")).toBeDefined()
		expect(screen.getByText("Analyze Device Logs")).toBeDefined()
		expect(screen.getByText("Record & analyze BLE behavior")).toBeDefined()
	})

	it("calls onModeSelect with log_generator when first button clicked", () => {
		const onModeSelect = vi.fn()
		render(<ModeSelector onModeSelect={onModeSelect} />)

		fireEvent.click(screen.getByTestId("mode-button-log_generator"))
		expect(onModeSelect).toHaveBeenCalledWith("log_generator")
	})

	it("calls onModeSelect with log_analyzer when second button clicked", () => {
		const onModeSelect = vi.fn()
		render(<ModeSelector onModeSelect={onModeSelect} />)

		fireEvent.click(screen.getByTestId("mode-button-log_analyzer"))
		expect(onModeSelect).toHaveBeenCalledWith("log_analyzer")
	})

	it("does not call onModeSelect when disabled", () => {
		const onModeSelect = vi.fn()
		render(<ModeSelector disabled onModeSelect={onModeSelect} />)

		fireEvent.click(screen.getByTestId("mode-button-log_generator"))
		expect(onModeSelect).not.toHaveBeenCalled()
	})

	it("renders welcome variant with header", () => {
		render(<ModeSelector onModeSelect={() => {}} variant="welcome" />)

		expect(screen.getByText("Nordic Logging Assistant")).toBeDefined()
		expect(screen.getByText("What would you like to do?")).toBeDefined()
	})

	it("renders inline variant with different header", () => {
		render(<ModeSelector onModeSelect={() => {}} variant="inline" />)

		expect(screen.getByText("What would you like to do next?")).toBeDefined()
	})
})
