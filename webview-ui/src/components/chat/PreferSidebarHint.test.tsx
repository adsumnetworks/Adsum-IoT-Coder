import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import PreferSidebarHint from "./PreferSidebarHint"

describe("PreferSidebarHint", () => {
	it("shows the one line in the session view", () => {
		render(<PreferSidebarHint view="session" />)
		expect(screen.getByTestId("prefer-sidebar-hint")).toHaveTextContent(
			"Prefer the sidebar? The rail is always there; ⌘K opens the palette.",
		)
	})

	it("never renders in the sidebar view", () => {
		const { container } = render(<PreferSidebarHint view="sidebar" />)
		expect(container).toBeEmptyDOMElement()
	})

	it("dismisses for this mount only — the × hides it, with no localStorage key to remember it", () => {
		render(<PreferSidebarHint view="session" />)
		fireEvent.click(screen.getByLabelText("Dismiss"))
		expect(screen.queryByTestId("prefer-sidebar-hint")).not.toBeInTheDocument()
	})
})
