import { RELEASE_NOTES } from "@shared/releaseNotes"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DEMO_SCENARIO_LIST } from "../../demoScenarios"
import DemoPicker from "../DemoPicker"

describe("DemoPicker", () => {
	it("hero: renders the picker heading and one row per registered scenario", () => {
		render(<DemoPicker onStartDemo={vi.fn()} />)
		expect(screen.getByText("Try it on a sample project")).toBeInTheDocument()
		for (const s of DEMO_SCENARIO_LIST) {
			expect(screen.getByTestId(`demo-scenario-${s.id}`)).toBeInTheDocument()
			expect(screen.getByText(s.title)).toBeInTheDocument()
		}
	})

	it("hero: shows each scenario's description (brief teaser when coming-soon) + nRF badge", () => {
		render(<DemoPicker onStartDemo={vi.fn()} />)
		for (const s of DEMO_SCENARIO_LIST) {
			// Coming-soon rows show a brief teaser instead of the full honestLabel (a dimmed roadmap row
			// needn't carry the full sell); live rows show the full honestLabel.
			const shown = s.comingSoon && s.teaser ? s.teaser : s.honestLabel
			expect(screen.getByText(shown)).toBeInTheDocument()
			if (s.comingSoon && s.teaser) {
				expect(screen.queryByText(s.honestLabel)).not.toBeInTheDocument()
			}
		}
		// Platform badge is the properly-cased "nRF" (A1: was lowercase "nrf").
		expect(screen.getAllByText("nRF").length).toBeGreaterThanOrEqual(1)
		expect(screen.queryByText("nrf")).not.toBeInTheDocument()
	})

	it("shows a 'New' badge on exactly the rows RELEASE_NOTES.newSamples names this release", () => {
		render(<DemoPicker onStartDemo={vi.fn()} />)
		// The badge is decided per release in one place (RELEASE_NOTES.newSamples), never set by hand on a
		// row: two rows had carried it from 0.1.7 to 0.4.0 because nothing ever took it off.
		const expected = DEMO_SCENARIO_LIST.filter((s) => RELEASE_NOTES.newSamples.includes(s.id)).length
		expect(DEMO_SCENARIO_LIST.filter((s) => s.isNew).length).toBe(expected)
		expect(screen.queryAllByText("New").length).toBe(expected)
	})

	it("every 'coming soon' placeholder row is disabled, shows 'soon', and never fires onStartDemo (A8/A9 — Omar wires them later)", () => {
		const onStartDemo = vi.fn()
		render(<DemoPicker onStartDemo={onStartDemo} />)
		// All scenarios may now be live (zero placeholders) — that's valid (e.g. hci-sniffer + esp-wifi
		// shipped). Whatever the count, the "soon" badge count must equal the placeholder count.
		const placeholders = DEMO_SCENARIO_LIST.filter((s) => s.comingSoon)
		expect(screen.queryAllByText("soon").length).toBe(placeholders.length)
		for (const s of placeholders) {
			const row = screen.getByTestId(`demo-scenario-${s.id}`) as HTMLButtonElement
			expect(row.disabled, `${s.id} should be disabled`).toBe(true)
			fireEvent.click(row)
		}
		expect(onStartDemo).not.toHaveBeenCalled()
	})

	it("clicking a runnable scenario row fires onStartDemo with that scenario id", () => {
		const onStartDemo = vi.fn()
		render(<DemoPicker onStartDemo={onStartDemo} />)
		fireEvent.click(screen.getByTestId("demo-scenario-cra-sample"))
		expect(onStartDemo).toHaveBeenCalledWith("cra-sample")
		fireEvent.click(screen.getByTestId("demo-scenario-nus-uart"))
		expect(onStartDemo).toHaveBeenCalledWith("nus-uart")
	})

	it("rerun (compact): rows still present, honest labels hidden", () => {
		render(<DemoPicker onStartDemo={vi.fn()} variant="rerun" />)
		for (const s of DEMO_SCENARIO_LIST) {
			expect(screen.getByTestId(`demo-scenario-${s.id}`)).toBeInTheDocument()
			expect(screen.queryByText(s.honestLabel)).not.toBeInTheDocument()
		}
	})

	it("heading says 'another' ONLY when a sample has actually run (hasRunDemo), decoupled from compact styling", () => {
		// Compact but no sample run yet (e.g. first-time WITH a project open) → must NOT say "another".
		const { unmount } = render(<DemoPicker onStartDemo={vi.fn()} variant="rerun" />)
		expect(screen.getByText("Try it on a sample project")).toBeInTheDocument()
		expect(screen.queryByText("Try another sample project")).not.toBeInTheDocument()
		unmount()
		// A sample has run → "Try another sample project".
		render(<DemoPicker hasRunDemo onStartDemo={vi.fn()} variant="rerun" />)
		expect(screen.getByText("Try another sample project")).toBeInTheDocument()
	})

	it("disabled: rows are disabled and do not fire onStartDemo", () => {
		const onStartDemo = vi.fn()
		render(<DemoPicker disabled onStartDemo={onStartDemo} />)
		const row = screen.getByTestId("demo-scenario-nus-uart") as HTMLButtonElement
		expect(row.disabled).toBe(true)
		fireEvent.click(row)
		expect(onStartDemo).not.toHaveBeenCalled()
	})
})
