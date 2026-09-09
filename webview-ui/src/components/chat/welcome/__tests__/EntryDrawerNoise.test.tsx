import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import EntryDrawer, { type DrawerRun } from "../EntryDrawer"

/**
 * What the drawer refuses to repeat.
 *
 * [SCREENSHOT 2026-09-04] Six consecutive rows read "works on nRF and on ESP32". A detail that is
 * identical on every row separates nothing; it just spends the width the title needs. A reason
 * earns its line only when it names something detected.
 * (The session-row cases that lived here left with the session list on 2026-09-09 — sessions are
 * the host's history view's, see HistoryViewItemRename.test.tsx for the rename contract.)
 */

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: { showTaskWithId: vi.fn(() => Promise.resolve()) },
}))

const run = (id: string, title: string): DrawerRun => ({ id, title, platform: "both", onRun: vi.fn() })

const draw = (over: Partial<React.ComponentProps<typeof EntryDrawer>> = {}) =>
	render(<EntryDrawer checks={[]} onClose={vi.fn()} open={true} runs={[]} samples={[]} {...(over as any)} />)

// The drawer now carries the account chip, which reads extension state. These cases render the
// drawer alone, so the chip is stubbed the way the other stateful children already are.
vi.mock("../AccountChip", () => ({ default: () => null }))

describe("the drawer drops what every row already says", () => {
	it("a reason that names no detection is not shown", () => {
		draw({
			runs: [
				{ item: run("1", "Build"), score: 30, why: "works on nRF and on ESP32", grounded: false },
				{ item: run("2", "Debug"), score: 30, why: "works on nRF and on ESP32", grounded: false },
			],
		})
		expect(screen.queryByText(/works on nRF/)).toBeNull()
	})

	/**
	 * The earlier rule here was "hide a reason every visible row repeats", and it failed on the
	 * real list: one product row said something specific, so the set of reasons had two members and
	 * six identical "works on nRF and on ESP32" lines came straight back. Whether a reason is worth
	 * a row is a property of that reason, not of what its neighbours happen to say.
	 */
	it("one grounded row does not drag the ungrounded ones back onto the screen", () => {
		draw({
			runs: [
				{ item: run("1", "Gateway"), score: 100, why: "this looks like a LEW840x project", grounded: true },
				{ item: run("2", "Build"), score: 30, why: "works on nRF and on ESP32", grounded: false },
				{ item: run("3", "Debug"), score: 30, why: "works on nRF and on ESP32", grounded: false },
			],
		})
		expect(screen.getByText(/this looks like a LEW840x project/)).toBeTruthy()
		expect(screen.queryByText(/works on nRF/)).toBeNull()
	})
})
