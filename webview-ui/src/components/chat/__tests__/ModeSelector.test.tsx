import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TaskServiceClient } from "@/services/grpc-client"
import ModeSelector from "../ModeSelector"
import { ACTIVE_MODES } from "../nordicModes"

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

	// These assertions are platform-agnostic: the welcome selector renders the
	// active platform's mode set (ACTIVE_MODES), which is nRF's 2 modes or ESP's
	// 3 depending on the IOT_PLATFORM the build/test env targets.
	it("renders a button for each active mode", () => {
		render(<ModeSelector onModeSelect={() => {}} />)

		expect(ACTIVE_MODES.length).toBeGreaterThan(0)
		for (const mode of ACTIVE_MODES) {
			expect(screen.getByTestId(`mode-button-${mode.id}`)).toBeDefined()
		}
	})

	it("renders title and description for each active mode", () => {
		render(<ModeSelector onModeSelect={() => {}} />)

		for (const mode of ACTIVE_MODES) {
			expect(screen.getByText(mode.title)).toBeDefined()
			expect(screen.getByText(mode.description)).toBeDefined()
		}
	})

	it("calls onModeSelect with the first active mode id when its button is clicked", () => {
		const onModeSelect = vi.fn()
		render(<ModeSelector onModeSelect={onModeSelect} />)

		const first = ACTIVE_MODES[0]
		fireEvent.click(screen.getByTestId(`mode-button-${first.id}`))
		expect(onModeSelect).toHaveBeenCalledWith(first.id)
	})

	it("calls onModeSelect with the second active mode id when its button is clicked", () => {
		const onModeSelect = vi.fn()
		render(<ModeSelector onModeSelect={onModeSelect} />)

		const second = ACTIVE_MODES[1]
		fireEvent.click(screen.getByTestId(`mode-button-${second.id}`))
		expect(onModeSelect).toHaveBeenCalledWith(second.id)
	})

	it("does not call onModeSelect when disabled", () => {
		const onModeSelect = vi.fn()
		render(<ModeSelector disabled onModeSelect={onModeSelect} />)

		fireEvent.click(screen.getByTestId(`mode-button-${ACTIVE_MODES[0].id}`))
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
