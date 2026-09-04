import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TaskServiceClient } from "@/services/grpc-client"
import EntryDrawer from "../EntryDrawer"

/**
 * The drawer as the session manager — [OPERATOR 2026-09-04] "history view isn't there anymore,
 * but we should be able to delete one or all, resume or rename the sessions."
 *
 * Rename keeps the first prompt: `title` is display only, `task` stays what the model was asked
 * and what the filter still matches. Delete-all is offered only in the full list, never beside
 * three recent rows. Both deletes are confirmed by the host, not here (webview confirm() is
 * blocked), so the calls below are the whole contract on this side.
 */

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		showTaskWithId: vi.fn(() => Promise.resolve()),
		deleteTasksWithIds: vi.fn(() => Promise.resolve()),
		deleteAllTaskHistory: vi.fn(() => Promise.resolve({ tasksDeleted: 0 })),
		renameTask: vi.fn(() => Promise.resolve()),
	},
}))

const sess = (id: string, task: string, title?: string) =>
	({
		id,
		ulid: id,
		ts: Date.now() - 6e5,
		task,
		title,
		cwdOnTaskInitialization: "/w/gw",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	}) as any

const draw = (history: any[]) =>
	render(<EntryDrawer checks={[]} history={history} onClose={vi.fn()} open={true} runs={[]} samples={[]} />)

beforeEach(() => vi.clearAllMocks())

describe("naming a session", () => {
	it("a renamed session shows its name, and the filter still finds it by its first prompt", () => {
		draw([sess("a", "dsdsd", "Gateway bring-up, day 1")])
		expect(screen.getByText("Gateway bring-up, day 1")).toBeTruthy()
		expect(screen.queryByText("dsdsd")).toBeNull()
		fireEvent.change(screen.getByTestId("entry-drawer-filter"), { target: { value: "dsdsd" } })
		expect(screen.getByText("Gateway bring-up, day 1")).toBeTruthy()
	})

	it("rename: pencil → inline input → Enter sends the new name for that session", () => {
		draw([sess("a", "xcxc")])
		fireEvent.click(screen.getByTestId("entry-drawer-session-rename"))
		const input = screen.getByTestId("entry-drawer-session-name") as HTMLInputElement
		fireEvent.change(input, { target: { value: "LTE failover proof" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(TaskServiceClient.renameTask).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "a", title: "LTE failover proof" }),
		)
	})

	it("Escape drops the edit and sends nothing", () => {
		draw([sess("a", "xcxc")])
		fireEvent.click(screen.getByTestId("entry-drawer-session-rename"))
		const input = screen.getByTestId("entry-drawer-session-name")
		fireEvent.change(input, { target: { value: "never" } })
		fireEvent.keyDown(input, { key: "Escape" })
		expect(TaskServiceClient.renameTask).not.toHaveBeenCalled()
		expect(screen.getByText("xcxc")).toBeTruthy()
	})

	it("an unchanged name is not sent", () => {
		draw([sess("a", "xcxc")])
		fireEvent.click(screen.getByTestId("entry-drawer-session-rename"))
		fireEvent.keyDown(screen.getByTestId("entry-drawer-session-name"), { key: "Enter" })
		expect(TaskServiceClient.renameTask).not.toHaveBeenCalled()
	})
})

describe("deleting sessions", () => {
	it("the trash on a row deletes that session only", () => {
		draw([sess("a", "one"), sess("b", "two")])
		fireEvent.click(screen.getAllByTestId("entry-drawer-session-delete")[1])
		expect(TaskServiceClient.deleteTasksWithIds).toHaveBeenCalledWith(expect.objectContaining({ value: ["b"] }))
	})

	it("delete-all is not offered beside the recent three", () => {
		draw([sess("a", "1"), sess("b", "2"), sess("c", "3"), sess("d", "4")])
		expect(screen.queryByTestId("entry-drawer-delete-all")).toBeNull()
	})

	it("delete-all appears in the full list and calls the host once", () => {
		draw([sess("a", "1"), sess("b", "2"), sess("c", "3"), sess("d", "4")])
		fireEvent.click(screen.getByTestId("entry-drawer-see-all"))
		fireEvent.click(screen.getByTestId("entry-drawer-delete-all"))
		expect(TaskServiceClient.deleteAllTaskHistory).toHaveBeenCalledTimes(1)
	})

	it("clicking the name still resumes — the actions did not steal the row", () => {
		draw([sess("a", "one")])
		fireEvent.click(screen.getByTestId("entry-drawer-session-open"))
		expect(TaskServiceClient.showTaskWithId).toHaveBeenCalledWith(expect.objectContaining({ value: "a" }))
	})
})
