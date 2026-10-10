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
})
