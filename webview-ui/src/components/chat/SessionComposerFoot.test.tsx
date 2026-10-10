import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { openSessionMock } = vi.hoisted(() => ({ openSessionMock: vi.fn().mockResolvedValue("") }))
vi.mock("@/components/rail/openSession", () => ({ openSession: openSessionMock }))

import SessionComposerFoot from "./SessionComposerFoot"

describe("SessionComposerFoot", () => {
	beforeEach(() => {
		openSessionMock.mockClear()
	})

	it("renders the mark, the folder name and the context percentage in the session view", () => {
		render(<SessionComposerFoot contextPercent={42.6} folderName="gateway-fw" view="session" />)
		expect(screen.getByTestId("session-composer-foot")).toBeInTheDocument()
		expect(screen.getByText("gateway-fw")).toBeInTheDocument()
		expect(screen.getByText("43% context")).toBeInTheDocument()
		expect(screen.getByText("◆")).toBeInTheDocument()
	})

	it("omits the folder name and the percentage when neither is known", () => {
		render(<SessionComposerFoot view="session" />)
		expect(screen.queryByText(/% context/)).not.toBeInTheDocument()
	})

	it("sends the host the existing openSession call when 'Something else' is clicked", () => {
		render(<SessionComposerFoot view="session" />)
		fireEvent.click(screen.getByRole("button", { name: /Something else/i }))
		expect(openSessionMock).toHaveBeenCalledWith({})
	})

	it("never renders in the sidebar view", () => {
		const { container } = render(<SessionComposerFoot folderName="gateway-fw" view="sidebar" />)
		expect(container).toBeEmptyDOMElement()
	})
})
