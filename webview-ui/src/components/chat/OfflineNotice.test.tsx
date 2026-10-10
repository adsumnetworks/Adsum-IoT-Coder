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

	it("says what still works when the host reports the API unreachable", () => {
		render(<OfflineNotice hostOffline={true} />)
		expect(screen.getByTestId("offline-notice")).toHaveTextContent(
			"Offline. Local tools, the knowledge already loaded and your files still work; the model and the registry do not.",
		)
	})
})
