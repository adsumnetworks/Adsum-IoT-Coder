import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import WelcomeView from "../WelcomeView"

/**
 * The drawer by keyboard alone.
 *
 * It sets `aria-modal` and covers the whole surface, and a dialog that claims to be modal while
 * Tab walks out into the page behind it is worse than one that never claimed it: the developer is
 * typing into a composer they cannot see, with a panel still on top of it. Closing must also hand
 * focus back, or the caret lands at the top of the document — disorienting for exactly the people
 * who reached for the keyboard in the first place.
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
// The coach mark is stubbed out, but its ELIGIBILITY is what the notice queue reads — stub both,
// or WelcomeView throws on a missing export the moment it asks which notice wins.
vi.mock("../DockCoachMark", () => ({ default: () => null, dockCoachEligible: () => false }))
vi.mock("../../UpgradeCard", () => ({ default: () => null }))

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
const sess = (n: number) => ({
	id: `k${n}`,
	ts: Date.now() - n * DAY,
	task: `session ${n}`,
	cwdOnTaskInitialization: "/w/gw",
})

const props = {
	onSelectMode: vi.fn(),
	onStartTask: vi.fn(),
	onStartDemo: vi.fn(),
	onUpgradeDismiss: vi.fn(),
	showUpgradeCard: false,
}

beforeEach(() => {
	vi.clearAllMocks()
	_store.clear()
	vi.mocked(useExtensionState).mockReturnValue({
		version: "1.0.0",
		openFolderPaths: ["/w/gw"],
		taskHistory: [sess(1), sess(2), sess(3), sess(4)],
		workspaceClassification: "none",
	} as any)
})

const focusables = () =>
	Array.from(
		screen
			.getByTestId("entry-drawer")
			.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'),
	).filter((el) => !el.hasAttribute("disabled"))

describe("the drawer by keyboard", () => {
	it("opening moves focus to the filter — the first thing you would want to type into", () => {
		render(<WelcomeView {...props} />)
		fireEvent.click(screen.getByTestId("entry-more-runs"))
		expect(document.activeElement).toBe(screen.getByTestId("entry-drawer-filter"))
	})

	it("Escape closes it", () => {
		render(<WelcomeView {...props} />)
		fireEvent.click(screen.getByTestId("entry-more-runs"))
		fireEvent.keyDown(document, { key: "Escape" })
		expect(screen.queryByTestId("entry-drawer")).toBeNull()
	})

	it("Tab off the last control wraps to the first instead of leaving the dialog", () => {
		render(<WelcomeView {...props} />)
		fireEvent.click(screen.getByTestId("entry-more-runs"))
		const stops = focusables()
		stops[stops.length - 1].focus()
		fireEvent.keyDown(document, { key: "Tab" })
		expect(document.activeElement).toBe(stops[0])
	})

	it("Shift+Tab off the first wraps to the last, the same way round", () => {
		render(<WelcomeView {...props} />)
		fireEvent.click(screen.getByTestId("entry-more-runs"))
		const stops = focusables()
		stops[0].focus()
		fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
		expect(document.activeElement).toBe(stops[stops.length - 1])
	})

	it("focus that has escaped to the page behind is pulled back in", () => {
		render(<WelcomeView {...props} />)
		const door = screen.getByTestId("entry-more-runs")
		fireEvent.click(door)
		// Something outside took focus — a click-through, or a stray programmatic focus.
		door.focus()
		fireEvent.keyDown(document, { key: "Tab" })
		expect(screen.getByTestId("entry-drawer").contains(document.activeElement)).toBe(true)
	})

	it("closing hands focus back to the control that opened it — the All runs line", () => {
		render(<WelcomeView {...props} />)
		const door = screen.getByTestId("entry-more-runs")
		door.focus()
		fireEvent.click(door)
		fireEvent.keyDown(document, { key: "Escape" })
		expect(document.activeElement).toBe(door)
	})
})
