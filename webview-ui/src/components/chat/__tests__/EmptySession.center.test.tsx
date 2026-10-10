import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"
import EmptySession from "../EmptySession"

/**
 * [0.5] The empty session tab opens like a conversation page: the coral mark in the middle, the two lines
 * centred beneath it (the operator's last tweak, 10 Oct).
 */
describe("EmptySession", () => {
	it("centres the two lines under the mark", () => {
		render(
			<ExtensionStateContextProvider>
				<EmptySession onPrefill={() => {}} onStartTask={() => {}} />
			</ExtensionStateContextProvider>,
		)
		const hero = screen.getByTestId("empty-session-hero")
		expect(hero.style.textAlign).toBe("center")
		expect(hero.style.alignItems).toBe("center")
		// The mark comes first, then the two lines.
		expect(hero.firstElementChild?.querySelector("svg")).not.toBeNull()
		expect(hero.textContent).toContain("New session")
		expect(hero.textContent).toContain("Say what you want done, then Enter.")
	})
})
