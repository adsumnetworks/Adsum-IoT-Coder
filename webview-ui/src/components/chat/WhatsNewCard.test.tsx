import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import WhatsNewCard, { whatsNewEligible } from "./WhatsNewCard"

// This jsdom setup carries no real localStorage — see FirstSteps.test.tsx for the confirmation. Same
// fake store, same shape as EntryDrawerKeyboard.test.tsx's.
const _store = new Map<string, string>()
vi.stubGlobal("localStorage", {
	clear: () => _store.clear(),
	getItem: (k: string) => _store.get(k) ?? null,
	removeItem: (k: string) => _store.delete(k),
	setItem: (k: string, v: string) => {
		_store.set(k, v)
	},
})

beforeEach(() => {
	localStorage.clear()
})

describe("whatsNewEligible", () => {
	it("is eligible until dismissed", () => {
		expect(whatsNewEligible()).toBe(true)
		localStorage.setItem("adsum.whatsNew.0.5", "1")
		expect(whatsNewEligible()).toBe(false)
	})
})

describe("WhatsNewCard", () => {
	it("shows the coral title and the one sentence", () => {
		render(<WhatsNewCard />)
		expect(screen.getByTestId("whats-new-card")).toBeInTheDocument()
		expect(screen.getByText("0.5 · Sessions first")).toBeInTheDocument()
		expect(screen.getByText(/the cards live in What can you ask/)).toBeInTheDocument()
	})

	it("dismisses for good — the × hides the card and localStorage remembers it", () => {
		render(<WhatsNewCard />)
		fireEvent.click(screen.getByLabelText("Dismiss What's new"))
		expect(screen.queryByTestId("whats-new-card")).not.toBeInTheDocument()
		expect(localStorage.getItem("adsum.whatsNew.0.5")).toBe("1")
	})

	it("never renders once already dismissed", () => {
		localStorage.setItem("adsum.whatsNew.0.5", "1")
		render(<WhatsNewCard />)
		expect(screen.queryByTestId("whats-new-card")).not.toBeInTheDocument()
	})

	// [0.5.1 bench] The rail drew the coral frame around the card; the × removed the card and left the frame,
	// an empty orange strip. The frame is the card's own now, so nothing at all is left behind.
	it("framed, it draws the coral notice frame itself and announces like the rail's other notices", () => {
		render(<WhatsNewCard framed />)
		const frame = screen.getByTestId("whats-new-frame")
		expect(frame).toHaveAttribute("role", "status")
		expect(frame).toHaveAttribute("aria-live", "polite")
		expect(frame.getAttribute("style")).toContain("border")
		expect(frame).toContainElement(screen.getByTestId("whats-new-card"))
	})

	it("framed, the × leaves an empty container: no frame stays behind", () => {
		const { container } = render(<WhatsNewCard framed />)
		expect(container).not.toBeEmptyDOMElement()
		fireEvent.click(screen.getByLabelText("Dismiss What's new"))
		expect(container).toBeEmptyDOMElement()
	})

	it("bare (an empty session tab), there is no frame at all", () => {
		render(<WhatsNewCard />)
		expect(screen.queryByTestId("whats-new-frame")).not.toBeInTheDocument()
	})
})
