import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import SessionComposerFoot from "./SessionComposerFoot"

describe("SessionComposerFoot", () => {
	it("renders the mark, the folder name and the context percentage in the session view", () => {
		render(<SessionComposerFoot contextPercent={42.6} folderName="gateway-fw" onOpenPalette={vi.fn()} view="session" />)
		expect(screen.getByTestId("session-composer-foot")).toBeInTheDocument()
		expect(screen.getByText("gateway-fw")).toBeInTheDocument()
		expect(screen.getByText("43% context")).toBeInTheDocument()
		expect(screen.getByText("◆")).toBeInTheDocument()
	})

	it("omits the folder name and the percentage when neither is known", () => {
		render(<SessionComposerFoot onOpenPalette={vi.fn()} view="session" />)
		expect(screen.queryByText(/% context/)).not.toBeInTheDocument()
	})

	it("hides the context percentage until a task exists, even if one is passed in", () => {
		render(<SessionComposerFoot contextPercent={42.6} hasTask={false} onOpenPalette={vi.fn()} view="session" />)
		expect(screen.queryByText(/% context/)).not.toBeInTheDocument()
	})

	it("calls onOpenPalette when 'Something else' is clicked — the foot handle opens the dialog", () => {
		const onOpenPalette = vi.fn()
		render(<SessionComposerFoot onOpenPalette={onOpenPalette} view="session" />)
		fireEvent.click(screen.getByRole("button", { name: /Something else/i }))
		expect(onOpenPalette).toHaveBeenCalledTimes(1)
	})

	it("never renders in the sidebar view", () => {
		const { container } = render(<SessionComposerFoot folderName="gateway-fw" onOpenPalette={vi.fn()} view="sidebar" />)
		expect(container).toBeEmptyDOMElement()
	})
})
