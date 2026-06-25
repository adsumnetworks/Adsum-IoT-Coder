import { fireEvent, render, screen } from "@testing-library/react"
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
vi.mock("../../UpgradeCard", () => ({ default: () => <div data-testid="upgrade-card" /> }))

// jsdom's default opaque origin doesn't expose localStorage — provide a deterministic in-memory one so the
// nudge dismiss-persistence path is exercised (and cleared between tests).
const _store = new Map<string, string>()
vi.stubGlobal("localStorage", {
	getItem: (k: string) => _store.get(k) ?? null,
	setItem: (k: string, v: string) => {
		_store.set(k, v)
	},
	removeItem: (k: string) => {
		_store.delete(k)
	},
	clear: () => {
		_store.clear()
	},
})

const DEMO_TASK = "Debug a real BLE NUS bug — Central→Peripheral works, but Peripheral→Central is silently dropped."

const mockState = (opts: {
	openFolderPaths?: string[]
	taskHistory?: { task: string }[]
	workspaceFeatures?: { hasBle: boolean; hasComplianceArtifacts: boolean }
	workspaceClassification?: "nrf" | "esp" | "both" | "none"
}) => {
	vi.mocked(useExtensionState).mockReturnValue({
		navigateToHistory: vi.fn(),
		version: "1.0.0",
		openFolderPaths: opts.openFolderPaths ?? [],
		taskHistory: opts.taskHistory ?? [],
		workspaceFeatures: opts.workspaceFeatures,
		workspaceClassification: opts.workspaceClassification,
	} as any)
}

const baseProps = {
	onSelectMode: vi.fn(),
	onStartTask: vi.fn(),
	onStartDemo: vi.fn(),
	onUpgradeDismiss: vi.fn(),
	showUpgradeCard: false,
}

describe("WelcomeView — sample picker hierarchy (single cyan focal point)", () => {
	beforeEach(() => {
		vi.mocked(useExtensionState).mockReset()
	})

	it("no project, first run → the sample picker is the cyan hero (sole focal), nothing demoted", () => {
		mockState({ openFolderPaths: [], taskHistory: [] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("demo-picker")).toBeInTheDocument()
		expect(screen.getByText("Try it on a sample project")).toBeInTheDocument()
		expect(screen.queryByText("Try another sample project")).not.toBeInTheDocument()
	})

	it("project open, first run → the primary intent leads; the sample demotes but does NOT say 'another'", () => {
		// dev-as-hero: with a real project open, "Build, flash & debug" is the focal point — the sample drops to
		// the quiet compact form (hero-only caption gone). But no sample has run yet, so the heading must read
		// "Try it on a sample project", NOT "Try another sample project" (the first-time-with-project wording bug).
		mockState({ openFolderPaths: ["/Users/me/central_uart"], taskHistory: [] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("intent-card-buildFlashDebug")).toBeInTheDocument()
		// demoted/compact: the hero-only caption is hidden, but the picker rows are still present.
		expect(screen.queryByText(/Run Adsum on our sample/)).not.toBeInTheDocument()
		expect(screen.getByTestId("demo-scenario-cra-sample")).toBeInTheDocument()
		// the fix: first-run-with-project → "Try it on a sample project", never "another".
		expect(screen.getByText("Try it on a sample project")).toBeInTheDocument()
		expect(screen.queryByText("Try another sample project")).not.toBeInTheDocument()
	})

	it("after a sample has run → it demotes regardless of project state", () => {
		// Regression: demotion keys off task history (hasRunDemo, ANY registered scenario), not a transient flag.
		mockState({ openFolderPaths: [], taskHistory: [{ task: DEMO_TASK }] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByText("Try it on a sample project")).not.toBeInTheDocument()
		expect(screen.getByText("Try another sample project")).toBeInTheDocument()
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

describe("WelcomeView — grounded CRA nudge + deep-debug sub-line (A3/A10 + precedence)", () => {
	const PROJ = ["/Users/me/peripheral_uart"]
	const SUBLINE = "intent-card-buildFlashDebug-subline"

	beforeEach(() => {
		vi.mocked(useExtensionState).mockReset()
		localStorage.clear() // the nudge dismiss now persists in localStorage — isolate tests
	})

	it("project + BLE + no SBOM → CRA nudge shows; the deep-debug sub-line is suppressed (one promotion)", () => {
		mockState({ openFolderPaths: PROJ, taskHistory: [], workspaceFeatures: { hasBle: true, hasComplianceArtifacts: false } })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("cra-nudge")).toBeInTheDocument()
		expect(screen.queryByTestId(SUBLINE)).not.toBeInTheDocument()
	})

	it("project + BLE + SBOM exists → nudge demotes; sub-line shows; CRA card switches to re-run copy but KEEPS the New badge", () => {
		mockState({ openFolderPaths: PROJ, taskHistory: [], workspaceFeatures: { hasBle: true, hasComplianceArtifacts: true } })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByTestId("cra-nudge")).not.toBeInTheDocument()
		expect(screen.getByTestId(SUBLINE)).toBeInTheDocument()
		const craCard = screen.getByTestId("intent-card-craCheck")
		expect(craCard.textContent).toContain("Re-run on your build")
		// CRA stays flagged as a new capability even after compliance/ exists.
		expect(craCard.textContent).toContain("New")
	})

	it("project, no BLE → neither the nudge nor the sub-line", () => {
		mockState({ openFolderPaths: PROJ, taskHistory: [], workspaceFeatures: { hasBle: false, hasComplianceArtifacts: false } })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByTestId("cra-nudge")).not.toBeInTheDocument()
		expect(screen.queryByTestId(SUBLINE)).not.toBeInTheDocument()
	})

	it("no project → no CRA nudge (project-open surface only), even if a BLE flag leaks through", () => {
		mockState({ openFolderPaths: [], taskHistory: [], workspaceFeatures: { hasBle: true, hasComplianceArtifacts: false } })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByTestId("cra-nudge")).not.toBeInTheDocument()
	})

	it("missing workspaceFeatures (pre-hydration) → degrades to no nudge, no sub-line", () => {
		mockState({ openFolderPaths: PROJ, taskHistory: [] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByTestId("cra-nudge")).not.toBeInTheDocument()
		expect(screen.queryByTestId(SUBLINE)).not.toBeInTheDocument()
	})

	it("nudge Preview routes to onStartTask with the CRA prompt (project name threaded; not onSelectMode)", () => {
		const onStartTask = vi.fn()
		const onSelectMode = vi.fn()
		mockState({ openFolderPaths: PROJ, taskHistory: [], workspaceFeatures: { hasBle: true, hasComplianceArtifacts: false } })
		render(<WelcomeView {...baseProps} onSelectMode={onSelectMode} onStartTask={onStartTask} />)
		fireEvent.click(screen.getByTestId("cra-nudge-preview"))
		expect(onStartTask).toHaveBeenCalledOnce()
		expect(onStartTask.mock.calls[0][0]).toContain("CRA SBOM & Fix")
		expect(onStartTask.mock.calls[0][0]).toContain("peripheral_uart")
		expect(onSelectMode).not.toHaveBeenCalled()
	})

	it("demoted craCheck card (SBOM exists) still routes to onStartTask with the CRA prompt (copy switch ≠ routing)", () => {
		const onStartTask = vi.fn()
		mockState({ openFolderPaths: PROJ, taskHistory: [], workspaceFeatures: { hasBle: true, hasComplianceArtifacts: true } })
		render(<WelcomeView {...baseProps} onStartTask={onStartTask} />)
		fireEvent.click(screen.getByTestId("intent-card-craCheck"))
		expect(onStartTask).toHaveBeenCalledOnce()
		expect(onStartTask.mock.calls[0][0]).toContain("CRA SBOM & Fix")
	})

	it("dormant + CRA nudge → nudge wins, UpgradeCard suppressed (one grounded promotion)", () => {
		mockState({
			openFolderPaths: PROJ,
			taskHistory: [{ task: "x" }],
			workspaceFeatures: { hasBle: true, hasComplianceArtifacts: false },
		})
		render(<WelcomeView {...baseProps} showUpgradeCard={true} />)
		expect(screen.getByTestId("cra-nudge")).toBeInTheDocument()
		expect(screen.queryByTestId("upgrade-card")).not.toBeInTheDocument()
	})

	it("dormant + no CRA nudge (compliance present) → UpgradeCard shows", () => {
		mockState({
			openFolderPaths: PROJ,
			taskHistory: [{ task: "x" }],
			workspaceFeatures: { hasBle: true, hasComplianceArtifacts: true },
		})
		render(<WelcomeView {...baseProps} showUpgradeCard={true} />)
		expect(screen.queryByTestId("cra-nudge")).not.toBeInTheDocument()
		expect(screen.getByTestId("upgrade-card")).toBeInTheDocument()
	})

	it("ESP-classified project → Add a feature card uses ESP wording (platform threads through)", () => {
		mockState({ openFolderPaths: ["/Users/me/esp_app"], taskHistory: [], workspaceClassification: "esp" })
		render(<WelcomeView {...baseProps} />)
		const addFeature = screen.getByTestId("intent-card-addFeature").textContent ?? ""
		expect(addFeature).toContain("Wi-Fi")
		expect(addFeature).not.toContain("Zephyr")
	})

	it("dismissing the nudge reveals the deep-debug sub-line (precedence yields)", () => {
		mockState({ openFolderPaths: PROJ, taskHistory: [], workspaceFeatures: { hasBle: true, hasComplianceArtifacts: false } })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByTestId(SUBLINE)).not.toBeInTheDocument()
		fireEvent.click(screen.getByTestId("cra-nudge-dismiss"))
		expect(screen.queryByTestId("cra-nudge")).not.toBeInTheDocument()
		expect(screen.getByTestId(SUBLINE)).toBeInTheDocument()
	})
})
