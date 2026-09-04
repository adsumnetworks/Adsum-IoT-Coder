import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import WelcomeView from "../WelcomeView"

/**
 * The entry surface.
 *
 * Rewritten with the cockpit. The rules carried over from the previous surface — one grounded
 * promotion per paint, the CRA nudge's evidence grounding, and cards that route rather than just
 * render — are still asserted here, because those were never about the layout. What is new is the
 * shape rule, the single home for sessions, and the reason attached to every suggestion.
 */

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: vi.fn() }))
vi.mock("@/hooks/useVSCodeTheme", () => ({ useVSCodeTheme: () => ({ isDark: true }) }))
vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: { openFolder: vi.fn() },
	StateServiceClient: {
		dismissBanner: vi.fn(() => Promise.resolve()),
		captureEntryEvent: vi.fn(() => Promise.resolve()),
	},
	TaskServiceClient: { showTaskWithId: vi.fn(() => Promise.resolve()) },
	WebServiceClient: { openInBrowser: vi.fn(() => Promise.resolve()) },
}))
vi.mock("../StatusHeader", () => ({ default: () => null }))
vi.mock("../DockCoachMark", () => ({ default: () => null }))
vi.mock("../../UpgradeCard", () => ({ default: () => <div data-testid="upgrade-card" /> }))

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

const DAY = 24 * 60 * 60 * 1000
const sess = (n: number, cwd: string, ageDays = 0.1, task = `session ${n}`) => ({
	id: `t${n}`,
	ts: Date.now() - ageDays * DAY,
	task,
	cwdOnTaskInitialization: cwd,
})

const mockState = (opts: {
	openFolderPaths?: string[]
	taskHistory?: unknown[]
	workspaceFeatures?: { hasBle?: boolean; hasWifi?: boolean; hasComplianceArtifacts?: boolean }
	workspaceClassification?: "nrf" | "esp" | "both" | "none"
	nrfEnvironment?: unknown
	espEnvironment?: unknown
	reviewNudgeShow?: boolean
}) => {
	vi.mocked(useExtensionState).mockReturnValue({
		version: "1.0.0",
		openFolderPaths: opts.openFolderPaths ?? [],
		taskHistory: opts.taskHistory ?? [],
		workspaceFeatures: opts.workspaceFeatures,
		workspaceClassification: opts.workspaceClassification ?? "none",
		nrfEnvironment: opts.nrfEnvironment,
		espEnvironment: opts.espEnvironment,
		reviewNudgeShow: opts.reviewNudgeShow,
	} as any)
}

const baseProps = {
	onSelectMode: vi.fn(),
	onStartTask: vi.fn(),
	onStartDemo: vi.fn(),
	onUpgradeDismiss: vi.fn(),
	showUpgradeCard: false,
}

beforeEach(() => {
	vi.clearAllMocks()
	_store.clear()
})

describe("the shape rule decides what is on screen", () => {
	it("cold start — no folder, no history — leads with the sample runs and no build cards", () => {
		mockState({})
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("entry-samples")).toBeTruthy()
		expect(screen.getAllByTestId("entry-sample").length).toBeGreaterThanOrEqual(2)
		expect(screen.queryByText("Suggested runs")).toBeNull()
	})

	it("a sample fires on one click — it is pre-canned, so it needs no second confirming act", () => {
		mockState({})
		render(<WelcomeView {...baseProps} />)
		fireEvent.click(screen.getAllByTestId("entry-sample")[0])
		expect(baseProps.onStartDemo).toHaveBeenCalledTimes(1)
	})

	it("first run with firmware open — the project leads with suggested runs, not the samples", () => {
		mockState({ openFolderPaths: ["/w/gateway-fw"] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByText("Suggested runs")).toBeTruthy()
		expect(screen.queryByTestId("entry-samples")).toBeNull()
	})

	it("two fresh sessions — collapsed: one named resume, no cards", () => {
		mockState({ openFolderPaths: ["/w/gw"], taskHistory: [sess(1, "/w/gw", 0.1), sess(2, "/w/gw", 2)] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("entry-resume")).toBeTruthy()
		expect(screen.queryByText("Suggested runs")).toBeNull()
	})

	it("away for a month — the cards come back rather than making them remember", () => {
		mockState({ openFolderPaths: ["/w/gw"], taskHistory: [sess(1, "/w/gw", 31), sess(2, "/w/gw", 40)] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByText("Suggested runs")).toBeTruthy()
		expect(screen.queryByTestId("entry-resume")).toBeNull()
	})

	it("returning, but nothing in this folder — the runs come back AND the line says where the rest went", () => {
		// [SCREENSHOT 2026-09-04] This state used to collapse: no resume existed, so the cards were
		// removed and nothing replaced them. Someone with 52 sessions elsewhere opened a new project
		// to an empty panel. Now it expands — and still says, reachably, where their history is.
		mockState({ openFolderPaths: ["/w/gw"], taskHistory: [sess(1, "/w/other", 1), sess(2, "/w/other", 2)] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByTestId("entry-resume")).toBeNull()
		expect(screen.getByText("Suggested runs")).toBeTruthy()
		expect(screen.getByTestId("entry-orientation").textContent).toContain("2 sessions in other folders")
	})

	it("that line is a way to reach them, not a dead end", () => {
		mockState({ openFolderPaths: ["/w/gw"], taskHistory: [sess(1, "/w/other", 1), sess(2, "/w/other", 2)] })
		render(<WelcomeView {...baseProps} />)
		fireEvent.click(screen.getByTestId("entry-elsewhere"))
		expect(screen.getByTestId("entry-drawer")).toBeTruthy()
	})

	it("the header names the folder and what is actually plugged in", () => {
		mockState({
			openFolderPaths: ["/w/gateway-fw"],
			nrfEnvironment: { boards: [{ productName: "nRF52840 DK" }] },
		})
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("entry-scope-title").textContent).toBe("gateway-fw")
		expect(screen.getByTestId("entry-devices").textContent).toContain("nRF52840 DK")
	})

	it("with nothing connected it says so plainly — absence is a fact, not a fault", () => {
		mockState({ openFolderPaths: ["/w/gateway-fw"] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("entry-devices").textContent).toContain("no boards detected")
	})
})

describe("a handover row resumes into the agent's session, not a task", () => {
	it("says whose session it is, because opening it lands somewhere different", () => {
		mockState({
			openFolderPaths: ["/w/gw"],
			taskHistory: [{ ...sess(1, "/w/gw", 0.05, "your agent worked this"), handoverId: "h-1" }, sess(2, "/w/gw", 3)],
		})
		render(<WelcomeView {...baseProps} />)
		const resume = screen.getByTestId("entry-resume")
		expect(resume.textContent).toContain("your agent's session")
		// And not the folder line an ordinary session would carry — the destination differs, so
		// the label has to as well.
		expect(resume.textContent).not.toContain("gw ·")
	})

	it("an ordinary newest session keeps the folder line", () => {
		mockState({ openFolderPaths: ["/w/gw"], taskHistory: [sess(1, "/w/gw", 0.05), sess(2, "/w/gw", 3)] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByTestId("entry-resume").textContent).toContain("gw")
	})
})

describe("sessions have exactly one home", () => {
	it("no session list is on the surface — only the drawer holds them", () => {
		mockState({ openFolderPaths: ["/w/gw"], taskHistory: [sess(1, "/w/gw"), sess(2, "/w/gw", 1), sess(3, "/w/gw", 2)] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryAllByTestId("entry-drawer-session")).toHaveLength(0)
	})

	it("the drawer shows the recent few and opens onto all of them", () => {
		const many = Array.from({ length: 6 }, (_, i) => sess(i, "/w/gw", i))
		mockState({ openFolderPaths: ["/w/gw"], taskHistory: many })
		render(<WelcomeView {...baseProps} />)
		fireEvent.click(screen.getByTestId("entry-burger"))
		expect(screen.getAllByTestId("entry-drawer-session")).toHaveLength(3)
		fireEvent.click(screen.getByTestId("entry-drawer-see-all"))
		expect(screen.getAllByTestId("entry-drawer-session")).toHaveLength(6)
	})

	it("the filter searches every session, not just the visible three", () => {
		const many = [
			...Array.from({ length: 5 }, (_, i) => sess(i, "/w/gw", i, `recent ${i}`)),
			sess(99, "/w/gw", 20, "the buried needle"),
		]
		mockState({ openFolderPaths: ["/w/gw"], taskHistory: many })
		render(<WelcomeView {...baseProps} />)
		fireEvent.click(screen.getByTestId("entry-burger"))
		fireEvent.change(screen.getByTestId("entry-drawer-filter"), { target: { value: "needle" } })
		expect(screen.getAllByTestId("entry-drawer-session")).toHaveLength(1)
	})

	it("the unseen-run dot clears when the drawer opens, whether or not anything is clicked", () => {
		mockState({ openFolderPaths: ["/w/gw"] })
		const { rerender } = render(<WelcomeView {...baseProps} />)
		expect(screen.queryByTestId("entry-burger-badge")).toBeTruthy()
		fireEvent.click(screen.getByTestId("entry-burger"))
		rerender(<WelcomeView {...baseProps} />)
		expect(screen.queryByTestId("entry-burger-badge")).toBeNull()
	})
})

describe("every suggestion says why", () => {
	it("a connected nRF board is named as the reason", () => {
		mockState({
			openFolderPaths: ["/w/proj"],
			nrfEnvironment: { boards: [{ productName: "nRF52840 DK" }] },
		})
		render(<WelcomeView {...baseProps} />)
		// Every card that could run on that board says so — the reason is per-suggestion, not a
		// single banner, so more than one naming it is the correct outcome.
		expect(screen.getAllByText(/nRF52840 DK connected/).length).toBeGreaterThan(0)
	})

	it("with nothing detected it says it is showing a mix, rather than implying a recommendation", () => {
		mockState({ openFolderPaths: ["/w/proj"] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getAllByText(/◆/).length).toBeGreaterThan(0)
	})

	it("a card still routes — the reason line is decoration, the click is the point", () => {
		mockState({ openFolderPaths: ["/w/proj"] })
		render(<WelcomeView {...baseProps} />)
		const cards = screen.getAllByTestId(/^entry-run-/)
		fireEvent.click(cards[0])
		expect(baseProps.onStartTask.mock.calls.length + baseProps.onSelectMode.mock.calls.length).toBeGreaterThan(0)
	})
})

describe("one grounded promotion per paint — the rule that survived the rewrite", () => {
	const withBle = { hasBle: true, hasComplianceArtifacts: false }

	it("project + a connectivity stack + no SBOM → the CRA nudge, with its evidence", () => {
		mockState({ openFolderPaths: ["/w/proj"], workspaceFeatures: withBle })
		render(<WelcomeView {...baseProps} />)
		expect(screen.getByText(/no compliance artifacts in this project yet/)).toBeTruthy()
	})

	it("once compliance artifacts exist the nudge stands down", () => {
		mockState({
			openFolderPaths: ["/w/proj"],
			workspaceFeatures: { hasBle: true, hasComplianceArtifacts: true },
		})
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByText(/no compliance artifacts/)).toBeNull()
	})

	it("no project → no CRA nudge, even if a feature flag leaks through", () => {
		mockState({ workspaceFeatures: withBle })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByText(/no compliance artifacts/)).toBeNull()
	})

	it("the CRA nudge outranks the dormant upgrade card — only one promotion shows", () => {
		// The upgrade card is for a returning developer, so it needs history to be dormant at all.
		mockState({ openFolderPaths: ["/w/proj"], workspaceFeatures: withBle, taskHistory: [sess(1, "/w/proj", 40)] })
		render(<WelcomeView {...baseProps} showUpgradeCard={true} />)
		expect(screen.queryByTestId("upgrade-card")).toBeNull()
		expect(screen.getByText(/no compliance artifacts/)).toBeTruthy()
	})

	it("with no nudge to yield to, the upgrade card shows", () => {
		mockState({
			openFolderPaths: ["/w/proj"],
			workspaceFeatures: { hasBle: true, hasComplianceArtifacts: true },
			taskHistory: [sess(1, "/w/proj", 40)],
		})
		render(<WelcomeView {...baseProps} showUpgradeCard={true} />)
		expect(screen.getByTestId("upgrade-card")).toBeTruthy()
	})

	it("missing feature probes (pre-hydration) degrade to no nudge rather than a wrong one", () => {
		mockState({ openFolderPaths: ["/w/proj"] })
		render(<WelcomeView {...baseProps} />)
		expect(screen.queryByText(/no compliance artifacts/)).toBeNull()
	})
})
