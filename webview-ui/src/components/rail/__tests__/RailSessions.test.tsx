import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * [0.5.1 bench] A session row's age ("12 min", "3 h") sat under the ⋯ button, which floated over the row's
 * top right corner with an opaque background: the age read as a clipped number. The ⋯ is laid out beside
 * the row now. jsdom measures nothing, so this pins the structure: the age is rendered whole, the ⋯ is in
 * the flow (not positioned over the row), and the menu still opens, closes and keeps its three actions.
 */
const NOW = 1_800_000_000_000
const history = [
	{ id: "t1", ts: NOW - 12 * 60_000, task: "Read the gateway's logs", cwdOnTaskInitialization: "/Users/dev/gateway-fw" },
	{ id: "t2", ts: NOW - 3 * 3_600_000, task: "Flash the demo pair", cwdOnTaskInitialization: "/Users/dev/gateway-fw" },
]

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ taskHistory: history, openFolderPaths: ["/Users/dev/gateway-fw"], openSessions: [] }),
}))
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		renameTask: vi.fn(() => Promise.resolve()),
		toggleTaskFavorite: vi.fn(() => Promise.resolve()),
		deleteTasksWithIds: vi.fn(() => Promise.resolve()),
	},
}))

import RailSessions from "../RailSessions"

const draw = (onOpen = vi.fn()) => {
	render(<RailSessions onAll={vi.fn()} onNew={vi.fn()} onOpen={onOpen} />)
	return onOpen
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] })
	vi.setSystemTime(NOW)
})

describe("a session row in the rail", () => {
	it("shows the age whole, on one line, beside the title", () => {
		draw()
		const ages = screen.getAllByTestId("rail-session-age")
		expect(ages.map((a) => a.textContent)).toEqual(["12 min", "3 h"])
		for (const a of ages) {
			expect(a.style.whiteSpace).toBe("nowrap")
			// `flex: none` as jsdom stores it: the age never gives up width to the title.
			expect(a.style.flexShrink).toBe("0")
		}
	})

	it("lays the ⋯ out beside the row, never over it", () => {
		draw()
		const [row] = screen.getAllByTestId("rail-session-row")
		const menu = within(row).getByLabelText("Rename, favourite, delete")
		expect(menu.style.position).not.toBe("absolute")
		expect(menu.style.position).not.toBe("fixed")
		expect(row.style.display).toBe("flex")
		// The row gives up the width the ⋯ needs, and may shrink: the title is what gets cut, not the age.
		const open = within(row).getByTitle("Opens in a tab")
		expect(open.style.minWidth).toBe("0")
		expect(open.style.width).not.toBe("100%")
		// Keyboard order is the document's: the row first, then its ⋯.
		expect(open.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(menu.tagName).toBe("BUTTON")
		// The ⋯ is outside the row's own button, so a click on it never opens the session.
		expect(open).not.toContainElement(menu)
	})

	it("opens the menu with Rename, Favourite and Delete…, and only that row's", () => {
		const onOpen = draw()
		const [first] = screen.getAllByLabelText("Rename, favourite, delete")
		expect(first).toHaveAttribute("aria-expanded", "false")
		fireEvent.click(first)
		expect(first).toHaveAttribute("aria-expanded", "true")
		const menu = screen.getByRole("menu")
		expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeInTheDocument()
		expect(within(menu).getByRole("menuitem", { name: "Favourite" })).toBeInTheDocument()
		expect(within(menu).getByRole("menuitem", { name: "Delete…" })).toBeInTheDocument()
		expect(screen.getAllByRole("menu")).toHaveLength(1)
		expect(onOpen).not.toHaveBeenCalled()
	})

	it("closes the menu on Escape, on a click outside it, and on a second click of the ⋯", () => {
		draw()
		const [first] = screen.getAllByLabelText("Rename, favourite, delete")
		fireEvent.click(first)
		fireEvent.keyDown(document, { key: "Escape" })
		expect(screen.queryByRole("menu")).toBeNull()

		fireEvent.click(first)
		expect(screen.getByRole("menu")).toBeInTheDocument()
		fireEvent.pointerDown(document.body)
		expect(screen.queryByRole("menu")).toBeNull()

		fireEvent.click(first)
		fireEvent.click(first)
		expect(screen.queryByRole("menu")).toBeNull()
	})

	it("a click on the row still opens that session", () => {
		const onOpen = draw()
		fireEvent.click(screen.getByText("Read the gateway's logs"))
		expect(onOpen).toHaveBeenCalledTimes(1)
		expect(onOpen.mock.calls[0][0]).toMatchObject({ id: "t1" })
	})
})
