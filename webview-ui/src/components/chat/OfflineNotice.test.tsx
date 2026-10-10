import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import OfflineNotice from "./OfflineNotice"

describe("OfflineNotice", () => {
	it("renders nothing when the host has not reported an outage", () => {
		const { container } = render(<OfflineNotice />)
		expect(container).toBeEmptyDOMElement()
	})

	it("renders nothing when hostOffline is explicitly false", () => {
		const { container } = render(<OfflineNotice hostOffline={false} />)
		expect(container).toBeEmptyDOMElement()
	})

	it("is a single line — 'Offline', not a standing sentence — when the host reports the API unreachable", () => {
		render(<OfflineNotice hostOffline={true} />)
		expect(screen.getByTestId("offline-notice")).toHaveTextContent("Offline")
		expect(screen.getByTestId("offline-notice")).not.toHaveTextContent("Local tools")
	})

	it("puts the detail of what still works behind the Info, not on the line itself", () => {
		render(<OfflineNotice hostOffline={true} />)
		expect(screen.getByLabelText("Details")).toBeInTheDocument()
	})
})
