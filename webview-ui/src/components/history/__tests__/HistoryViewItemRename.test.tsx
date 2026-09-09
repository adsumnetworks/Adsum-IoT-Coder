import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TaskServiceClient } from "@/services/grpc-client"
import HistoryViewItem from "../HistoryViewItem"

/**
 * Rename, in the one place sessions now live.
 *
 * [OPERATOR 2026-09-04] "we should be able to delete one or all, resume or rename the sessions."
 * Rename was built into the entry drawer's session list; that list is gone (2026-09-09, approved:
 * the host's ↺ history is the one home), so the contract moves here unchanged. `title` is display
 * only — `task` stays what the model was asked — and the row shows the given name over the prompt.
 */

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: { getAgentSession: vi.fn(() => Promise.resolve({ value: "" })) },
	TaskServiceClient: {
		showTaskWithId: vi.fn(() => Promise.resolve()),
		renameTask: vi.fn(() => Promise.resolve()),
		exportTaskWithId: vi.fn(() => Promise.resolve()),
	},
}))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => ({ openAgentSession: vi.fn() }) }))

const item = (title?: string) =>
	({
		id: "t1",
		ulid: "t1",
		ts: Date.now() - 6e5,
		task: "Debug a real BLE NUS bug",
		title,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		size: 0,
	}) as any

const draw = (title?: string) =>
	render(
		<HistoryViewItem
			handleDeleteHistoryItem={vi.fn()}
			handleHistorySelect={vi.fn()}
			index={0}
			item={item(title)}
			pendingFavoriteToggles={{}}
			selectedItems={[]}
			toggleFavorite={vi.fn()}
		/>,
	)

beforeEach(() => vi.clearAllMocks())

describe("a session's name in the history view", () => {
	it("shows the given name over the first prompt, and keeps the prompt as the tooltip", () => {
		draw("Gateway bring-up")
		const t = screen.getByTestId("history-item-title")
		expect(t.textContent).toBe("Gateway bring-up")
		expect(t.getAttribute("title")).toBe("Debug a real BLE NUS bug")
	})

	it("with no given name, the first prompt is the name", () => {
		draw()
		expect(screen.getByTestId("history-item-title").textContent).toBe("Debug a real BLE NUS bug")
	})

	it("rename: pencil → inline input → Enter sends the new name for that session", () => {
		draw()
		fireEvent.click(screen.getByTestId("history-item-rename"))
		const input = screen.getByTestId("history-item-name") as HTMLInputElement
		expect(input.value).toBe("Debug a real BLE NUS bug")
		fireEvent.change(input, { target: { value: "NUS central" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(TaskServiceClient.renameTask).toHaveBeenCalledTimes(1)
		expect((TaskServiceClient.renameTask as any).mock.calls[0][0]).toMatchObject({ taskId: "t1", title: "NUS central" })
		expect(screen.queryByTestId("history-item-name")).toBeNull()
	})

	it("Escape drops the edit and sends nothing", () => {
		draw()
		fireEvent.click(screen.getByTestId("history-item-rename"))
		const input = screen.getByTestId("history-item-name")
		fireEvent.change(input, { target: { value: "half typed" } })
		fireEvent.keyDown(input, { key: "Escape" })
		expect(TaskServiceClient.renameTask).not.toHaveBeenCalled()
		expect(screen.getByTestId("history-item-title").textContent).toBe("Debug a real BLE NUS bug")
	})

	it("an unchanged or emptied name is not sent", () => {
		draw("Gateway bring-up")
		fireEvent.click(screen.getByTestId("history-item-rename"))
		fireEvent.keyDown(screen.getByTestId("history-item-name"), { key: "Enter" })
		fireEvent.click(screen.getByTestId("history-item-rename"))
		fireEvent.change(screen.getByTestId("history-item-name"), { target: { value: "   " } })
		fireEvent.keyDown(screen.getByTestId("history-item-name"), { key: "Enter" })
		expect(TaskServiceClient.renameTask).not.toHaveBeenCalled()
	})

	it("the pencil does not open the session — the row still does", () => {
		draw()
		fireEvent.click(screen.getByTestId("history-item-rename"))
		expect(TaskServiceClient.showTaskWithId).not.toHaveBeenCalled()
		fireEvent.keyDown(screen.getByTestId("history-item-name"), { key: "Escape" })
		fireEvent.click(screen.getByTestId("history-item-title"))
		expect(TaskServiceClient.showTaskWithId).toHaveBeenCalledTimes(1)
	})
})
