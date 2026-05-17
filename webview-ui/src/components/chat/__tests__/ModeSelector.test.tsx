import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TaskServiceClient } from "@/services/grpc-client"
import ModeSelector from "../ModeSelector"

const mockNavigateToHistory = vi.fn()
const mockTaskHistory: any[] = []

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(() => ({
		navigateToHistory: mockNavigateToHistory,
		taskHistory: mockTaskHistory,
	})),
}))

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		showTaskWithId: vi.fn().mockResolvedValue({}),
	},
}))

// Silence MutationObserver missing in jsdom
global.MutationObserver = class {
	observe() {}
	disconnect() {}
	takeRecords() {
		return []
	}
} as any

describe("ModeSelector", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockTaskHistory.length = 0
	})

	it("renders both mode buttons", () => {
		render(<ModeSelector onModeSelect={() => {}} />)

		expect(screen.getByTestId("mode-button-log_generator")).toBeDefined()
		expect(screen.getByTestId("mode-button-log_analyzer")).toBeDefined()
	})

	it("renders title and description for each mode", () => {
		render(<ModeSelector onModeSelect={() => {}} />)

		expect(screen.getByText("Generate Logging Code")).toBeDefined()
		expect(
			screen.getByText("Automatically inject professional logging into your code following the best practices."),
		).toBeDefined()
		expect(screen.getByText("Analyze Device Logs")).toBeDefined()
		expect(screen.getByText("Record, analyze, and generate reports from connected IoT devices.")).toBeDefined()
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

	it("renders welcome variant with header and history section", () => {
		render(<ModeSelector onModeSelect={() => {}} variant="welcome" />)

		expect(screen.getByText("What would you like to do?")).toBeDefined()
		expect(screen.getByText("Recent")).toBeDefined()
	})

	it("renders inline variant without history section", () => {
		render(<ModeSelector onModeSelect={() => {}} variant="inline" />)

		expect(screen.getByText("What would you like to do next?")).toBeDefined()
		expect(screen.queryByText("Recent")).toBeNull()
	})

	it("shows No recent tasks placeholder when history is empty", () => {
		render(<ModeSelector onModeSelect={() => {}} variant="welcome" />)

		expect(screen.getByText("No recent tasks")).toBeDefined()
	})

	it("renders session cards from context taskHistory", () => {
		mockTaskHistory.push(
			{ id: "1", task: "Debug BLE connection", ts: Date.now(), totalCost: 0.05, isFavorited: false },
			{ id: "2", task: "Generate logging code", ts: Date.now() - 1000, totalCost: 0.02, isFavorited: false },
		)

		render(<ModeSelector onModeSelect={() => {}} variant="welcome" />)

		// Free-form task text renders as-is
		expect(screen.getByText("Debug BLE connection")).toBeDefined()
		// Mode-matched task renders the mode title, not the raw systemPrompt string
		expect(screen.getAllByText("Generate Logging Code").length).toBeGreaterThan(0)
	})

	it("falls back to task text when mode is not detectable", () => {
		mockTaskHistory.push({
			id: "1",
			task: "why is my BLE connection failing?",
			ts: Date.now(),
			totalCost: 0,
			isFavorited: false,
		})

		render(<ModeSelector onModeSelect={() => {}} variant="welcome" />)

		expect(screen.getByText("why is my BLE connection failing?")).toBeDefined()
	})

	it("formats time as relative for recent tasks", () => {
		mockTaskHistory.push({
			id: "1",
			task: "Debug BLE connection",
			ts: Date.now() - 2 * 60 * 60 * 1000,
			totalCost: 0,
			isFavorited: false,
		})

		render(<ModeSelector onModeSelect={() => {}} variant="welcome" />)

		expect(screen.getByText("2h ago")).toBeDefined()
	})

	it("clicking a session card calls showTaskWithId", () => {
		mockTaskHistory.push({ id: "abc123", task: "Debug BLE connection", ts: Date.now(), totalCost: 0.05, isFavorited: false })

		render(<ModeSelector onModeSelect={() => {}} variant="welcome" />)

		fireEvent.click(screen.getByText("Debug BLE connection"))
		expect(TaskServiceClient.showTaskWithId).toHaveBeenCalled()
	})

	it("clicking View All calls navigateToHistory", () => {
		mockTaskHistory.push({ id: "abc123", task: "Debug BLE connection", ts: Date.now(), totalCost: 0.05, isFavorited: false })

		render(<ModeSelector onModeSelect={() => {}} variant="welcome" />)

		fireEvent.click(screen.getByText("View All"))
		expect(mockNavigateToHistory).toHaveBeenCalled()
	})
})
