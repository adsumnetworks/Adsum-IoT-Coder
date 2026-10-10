import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import SessionWordmark from "./SessionWordmark"

describe("SessionWordmark", () => {
	it("renders the mark and the name, centred, in the session view", () => {
		render(<SessionWordmark view="session" />)
		expect(screen.getByTestId("session-wordmark")).toBeInTheDocument()
		expect(screen.getByTestId("adsum-logo")).toHaveTextContent("Adsum IoT Coder")
	})

	it("never renders in the sidebar view", () => {
		const { container } = render(<SessionWordmark view="sidebar" />)
		expect(container).toBeEmptyDOMElement()
	})
})
