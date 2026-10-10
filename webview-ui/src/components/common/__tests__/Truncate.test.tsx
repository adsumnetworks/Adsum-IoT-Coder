import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import Truncate from "../Truncate"

/** jsdom lays nothing out, so the overflow is set by hand on the element before the hover. */
function hover(el: HTMLElement, scrollWidth: number, clientWidth: number) {
	Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth })
	Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth })
	fireEvent.mouseEnter(el)
}

describe("Truncate", () => {
	it("shows the whole text in a tooltip only when the line was cut", () => {
		render(<Truncate testId="t" text="LEW840x gateway build with a very long title that keeps going" />)
		const el = screen.getByTestId("t")
		hover(el, 400, 180)
		expect(screen.getByRole("tooltip").textContent).toBe("LEW840x gateway build with a very long title that keeps going")
		fireEvent.mouseLeave(el)
		expect(screen.queryByRole("tooltip")).toBeNull()
	})

	it("stays quiet when the text fits", () => {
		render(<Truncate testId="t" text="short" />)
		hover(screen.getByTestId("t"), 40, 180)
		expect(screen.queryByRole("tooltip")).toBeNull()
	})

	it("opens on keyboard focus too", () => {
		render(<Truncate testId="t" text="a long title that is cut" />)
		const el = screen.getByTestId("t")
		Object.defineProperty(el, "scrollWidth", { configurable: true, value: 300 })
		Object.defineProperty(el, "clientWidth", { configurable: true, value: 100 })
		fireEvent.focus(el)
		expect(screen.getByRole("tooltip")).toBeInTheDocument()
	})
})
