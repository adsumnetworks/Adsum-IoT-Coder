import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import EntryDrawer, { type DrawerRun } from "../EntryDrawer"

/**
 * What the drawer refuses to repeat.
 *
 * [SCREENSHOT 2026-09-04] Every row carried the same folder name and the same reason line — six
 * consecutive rows reading "works on nRF and on ESP32", and three sessions each labelled with the
 * one folder they all came from. A detail that is identical on every row separates nothing; it just
 * spends the width the title needs. Both are dropped only while they stay identical, so the moment
 * a second folder or a different reason appears they come back on their own.
 */

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: { showTaskWithId: vi.fn(() => Promise.resolve()) },
}))

const sess = (id: string, cwd: string) => ({ id, ulid: id, ts: Date.now() - 6e5, task: `task ${id}`, cwd }) as any
const withCwd = (id: string, cwd: string) => ({ ...sess(id, cwd), cwdOnTaskInitialization: cwd })
const run = (id: string, title: string): DrawerRun => ({ id, title, platform: "both", onRun: vi.fn() })

const draw = (over: Partial<React.ComponentProps<typeof EntryDrawer>> = {}) =>
	render(<EntryDrawer checks={[]} history={[]} onClose={vi.fn()} open={true} runs={[]} samples={[]} {...(over as any)} />)

// The drawer now carries the account chip, which reads extension state. These cases render the
// drawer alone, so the chip is stubbed the way the other stateful children already are.
vi.mock("../AccountChip", () => ({ default: () => null }))

describe("the drawer drops what every row already says", () => {
	it("one folder behind all the sessions: the age is enough", () => {
		draw({ history: [withCwd("a", "/w/gw"), withCwd("b", "/w/gw")] })
		expect(screen.queryByText(/gw ·/)).toBeNull()
	})

	it("two folders: the folder is back, because now it tells them apart", () => {
		draw({ history: [withCwd("a", "/w/gw"), withCwd("b", "/w/sensor")] })
		expect(screen.getByText(/^gw ·/)).toBeTruthy()
		expect(screen.getByText(/^sensor ·/)).toBeTruthy()
	})

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

	it("sessions sharing a title are separated by the clock, so the list can be read", () => {
		const same = (id: string, ts: number) =>
			({
				id,
				ulid: id,
				ts,
				task: "Debug a real BLE NUS bug",
				cwdOnTaskInitialization: "/w/gw",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}) as any
		const base = new Date("2026-09-03T09:15:00").getTime()
		draw({ history: [same("a", base), same("b", base - 3 * 3600_000)] })
		const rows = screen.getAllByTestId("entry-drawer-session").map((r) => r.textContent ?? "")
		expect(new Set(rows).size).toBe(2)
	})
})
