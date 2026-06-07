import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import NextStepChooser from "../NextStepChooser"

// Mock workspace state — the chooser branches on openFolderPaths.
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))
// Mock gRPC so an accidental openProject route never hits a real backend.
vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: { openFolder: vi.fn() },
}))

const mockState = (openFolderPaths: string[]) => {
	vi.mocked(useExtensionState).mockReturnValue({ openFolderPaths } as any)
}

describe("NextStepChooser — context-aware cards", () => {
	let onSelectMode: ReturnType<typeof vi.fn>
	let onStartTask: ReturnType<typeof vi.fn>
	let onStartDemo: ReturnType<typeof vi.fn>

	beforeEach(() => {
		onSelectMode = vi.fn()
		onStartTask = vi.fn()
		onStartDemo = vi.fn()
		vi.mocked(useExtensionState).mockReset()
	})

	const renderChooser = (isDemoRun: boolean) =>
		render(
			<NextStepChooser
				isDemoRun={isDemoRun}
				onSelectMode={onSelectMode}
				onStartDemo={onStartDemo}
				onStartTask={onStartTask}
			/>,
		)

	it("project open → renders the four project intents", () => {
		mockState(["/Users/me/central_uart"])
		renderChooser(false)
		expect(screen.getByTestId("next-step-addFeature")).toBeInTheDocument()
		expect(screen.getByTestId("next-step-debug")).toBeInTheDocument()
		expect(screen.getByTestId("next-step-buildFlash")).toBeInTheDocument()
		expect(screen.getByTestId("next-step-testValidate")).toBeInTheDocument()
		expect(screen.queryByTestId("next-step-prototype")).not.toBeInTheDocument()
	})

	it("no project → renders the no-project intents", () => {
		mockState([])
		renderChooser(false)
		expect(screen.getByTestId("next-step-prototype")).toBeInTheDocument()
		expect(screen.getByTestId("next-step-openProject")).toBeInTheDocument()
		expect(screen.queryByTestId("next-step-addFeature")).not.toBeInTheDocument()
	})

	it("after a demo run → shows the Re-run demo card and the 'Your turn' heading", () => {
		mockState(["/Users/me/central_uart"])
		renderChooser(true)
		expect(screen.getByTestId("demo-card-button")).toBeInTheDocument()
		expect(screen.getByText("Re-run demo")).toBeInTheDocument()
		expect(screen.getByText("Your turn — pick a next step…")).toBeInTheDocument()
	})

	it("after a non-demo task → no Re-run demo card, neutral heading", () => {
		mockState(["/Users/me/central_uart"])
		renderChooser(false)
		expect(screen.queryByTestId("demo-card-button")).not.toBeInTheDocument()
		expect(screen.getByText("What would you like to do next?")).toBeInTheDocument()
	})

	it("clicking Debug routes to log_analyzer mode (not a free-text task)", () => {
		mockState(["/Users/me/central_uart"])
		renderChooser(false)
		fireEvent.click(screen.getByTestId("next-step-debug"))
		expect(onSelectMode).toHaveBeenCalledWith("log_analyzer")
		expect(onStartTask).not.toHaveBeenCalled()
	})

	it("clicking Add a feature starts a task with the project-scoped prompt", () => {
		mockState(["/Users/me/central_uart"])
		renderChooser(false)
		fireEvent.click(screen.getByTestId("next-step-addFeature"))
		expect(onStartTask).toHaveBeenCalledTimes(1)
		expect(onStartTask.mock.calls[0][0]).toContain("central_uart")
	})

	it("clicking Re-run demo restarts the demo", () => {
		mockState([])
		renderChooser(true)
		fireEvent.click(screen.getByTestId("demo-card-button"))
		expect(onStartDemo).toHaveBeenCalledTimes(1)
	})
})
