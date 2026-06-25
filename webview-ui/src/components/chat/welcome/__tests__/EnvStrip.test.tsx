import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import EnvStrip from "../EnvStrip"

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: vi.fn() }))
vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: { refreshNrfEnvironment: vi.fn(() => Promise.resolve()) },
}))

const NRF_READY = {
	status: "ready",
	extensionPresent: true,
	nrfutilPresent: true,
	boards: [{ deviceName: "nRF5340 DK", boardVersion: "PCA10095", serialNumber: "1" }],
}
const ESP_ABSENT = { status: "ready", extensionPresent: false, idfPresent: false, projectDetected: false, espDevices: [] }

const mockState = (over: Record<string, unknown> = {}) =>
	vi.mocked(useExtensionState).mockReturnValue({
		openFolderPaths: [],
		nrfEnvironment: NRF_READY,
		espEnvironment: ESP_ABSENT,
		...over,
	} as any)

describe("EnvStrip — compact / expand (A5)", () => {
	beforeEach(() => {
		vi.mocked(useExtensionState).mockReset()
	})

	it("collapsed by default: shows the compact summary, not the full detail", () => {
		mockState()
		render(<EnvStrip />)
		const summary = screen.getByTestId("envstrip-summary")
		expect(summary).toBeInTheDocument()
		expect(screen.queryByTestId("envstrip-collapse")).not.toBeInTheDocument()
		expect(summary.textContent).toContain("nRF")
		expect(summary.textContent).toContain("nRF5340 DK")
	})

	it("click → expands to the full per-platform detail (collapse link appears)", () => {
		mockState()
		render(<EnvStrip />)
		fireEvent.click(screen.getByTestId("envstrip-summary"))
		expect(screen.getByTestId("envstrip-collapse")).toBeInTheDocument()
		expect(screen.queryByTestId("envstrip-summary")).not.toBeInTheDocument()
	})

	it("nothing detected → compact shows a setup hint (not platform rows)", () => {
		mockState({
			nrfEnvironment: { status: "ready", extensionPresent: false, nrfutilPresent: false, boards: [] },
			espEnvironment: ESP_ABSENT,
		})
		render(<EnvStrip />)
		expect(screen.getByTestId("envstrip-summary").textContent).toMatch(/No SDK detected/)
	})

	// a11y: the EnvStrip is a disclosure widget — its toggle must announce its state + control region to AT.
	it("disclosure a11y: toggle has aria-expanded (false→true), aria-label, aria-controls → the region id", () => {
		mockState()
		render(<EnvStrip />)
		const summary = screen.getByTestId("envstrip-summary")
		expect(summary).toHaveAttribute("aria-expanded", "false")
		expect(summary).toHaveAttribute("aria-label", "Show environment detail")
		expect(summary).toHaveAttribute("aria-controls", "envstrip-detail")
		fireEvent.click(summary)
		const collapse = screen.getByTestId("envstrip-collapse")
		expect(collapse).toHaveAttribute("aria-expanded", "true")
		expect(collapse).toHaveAttribute("aria-label", "Hide environment detail")
		expect(document.getElementById("envstrip-detail")).toBeInTheDocument()
	})
})
