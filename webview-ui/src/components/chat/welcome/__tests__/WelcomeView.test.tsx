import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import WelcomeView from "../WelcomeView"

// Mock state + theme hooks and the noisy children that pull their own context, so the test
// isolates WelcomeView's own decision: which demo card variant to show, and the intent cards.
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: vi.fn() }))
vi.mock("@/hooks/useVSCodeTheme", () => ({ useVSCodeTheme: () => ({ isDark: true }) }))
vi.mock("@/services/grpc-client", () => ({ FileServiceClient: { openFolder: vi.fn() } }))
vi.mock("@/components/history/HistoryPreview", () => ({ default: () => null }))
vi.mock("../StatusHeader", () => ({ default: () => null }))
vi.mock("../DockCoachMark", () => ({ default: () => null }))
vi.mock("../TenureNudge", () => ({ default: () => null }))
vi.mock("../../UpgradeCard", () => ({ default: () => null }))

const DEMO_TASK = "Debug a real BLE NUS bug — Central→Peripheral works, but Peripheral→Central is silently dropped."

const mockState = (opts: { openFolderPaths?: string[]; taskHistory?: { task: string }[] }) => {
	vi.mocked(useExtensionState).mockReturnValue({
		navigateToHistory: vi.fn(),
		version: "1.0.0",
		openFolderPaths: opts.openFolderPaths ?? [],
		taskHistory: opts.taskHistory ?? [],
	} as any)
}

const baseProps = {
	onSelectMode: vi.fn(),
	onStartTask: vi.fn(),
	onStartDemo: vi.fn(),
	onUpgradeDismiss: vi.fn(),
	showUpgradeCard: false,
}

describe("WelcomeView — demo card lifecycle (regression)", () => {
	beforeEach(() => {
		vi.mocked(useExtensionState).mockReset()
	})

	it("first run (no demo in history) → shows the cyan hero, no Re-run demo", () => {
		mockState({ openFolderPaths: ["/Users/me/central_uart"], taskHistory: [] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByText("See it debug a real bug")).toBeInTheDocument()
		expect(screen.queryByText("Re-run demo")).not.toBeInTheDocument()
	})

	it("after the demo has run once → hero is gone, demoted Re-run demo shows", () => {
		// This is the exact bug we fixed: the welcome demo card must demote based on task history,
		// not the transient isDemoRun flag.
		mockState({ openFolderPaths: ["/Users/me/central_uart"], taskHistory: [{ task: DEMO_TASK }] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByText("See it debug a real bug")).not.toBeInTheDocument()
		expect(screen.getByText("Re-run demo")).toBeInTheDocument()
	})

	it("demotion holds regardless of project state (no project)", () => {
		mockState({ openFolderPaths: [], taskHistory: [{ task: DEMO_TASK }] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByText("See it debug a real bug")).not.toBeInTheDocument()
		expect(screen.getByText("Re-run demo")).toBeInTheDocument()
	})
})

describe("WelcomeView — context-aware intent cards", () => {
	beforeEach(() => {
		vi.mocked(useExtensionState).mockReset()
	})

	it("project open → project intents (merged primary + roadmap)", () => {
		mockState({ openFolderPaths: ["/Users/me/central_uart"], taskHistory: [] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("intent-card-buildFlashDebug")).toBeInTheDocument()
		expect(screen.getByTestId("intent-card-addFeature")).toBeInTheDocument()
		expect(screen.getByTestId("intent-card-sdkMigration")).toBeInTheDocument()
		expect(screen.queryByTestId("intent-card-debug")).not.toBeInTheDocument()
		expect(screen.queryByTestId("intent-card-prototype")).not.toBeInTheDocument()
	})

	it("no project → no-project intents", () => {
		mockState({ openFolderPaths: [], taskHistory: [] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("intent-card-prototype")).toBeInTheDocument()
		expect(screen.getByTestId("intent-card-openProject")).toBeInTheDocument()
		expect(screen.queryByTestId("intent-card-addFeature")).not.toBeInTheDocument()
	})

	it("interpolates the project name into the Add a feature card", () => {
		mockState({ openFolderPaths: ["/Users/me/central_uart"], taskHistory: [] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("intent-card-addFeature").textContent).toContain("central_uart")
	})
})
