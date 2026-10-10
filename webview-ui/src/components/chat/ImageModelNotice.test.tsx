import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ImageModelNotice from "./ImageModelNotice"

describe("ImageModelNotice", () => {
	it("renders nothing when not shown", () => {
		const { container } = render(<ImageModelNotice onOpenSettings={vi.fn()} show={false} />)
		expect(container).toBeEmptyDOMElement()
	})

	it("shows the notice and opens Settings via the existing navigateToSettings callback", () => {
		const onOpenSettings = vi.fn()
		render(<ImageModelNotice onOpenSettings={onOpenSettings} show={true} />)
		expect(screen.getByTestId("image-model-notice")).toHaveTextContent("Images need a model that reads them.")
		fireEvent.click(screen.getByTestId("image-model-notice-link"))
		expect(onOpenSettings).toHaveBeenCalledTimes(1)
	})
})
