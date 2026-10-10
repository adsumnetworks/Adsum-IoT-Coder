import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
	current: {
		taskHistory: [] as Array<{ id: string; title?: string }>,
		onRelinquishControl: () => () => {},
		environment: "vscode",
		totalTasksSize: null,
		setTotalTasksSize: () => {},
	},
}))
const rpc = vi.hoisted(() => ({
	getTaskHistory: vi.fn(),
	deleteTasksWithIds: vi.fn().mockResolvedValue({}),
	toggleTaskFavorite: vi.fn().mockResolvedValue({}),
	getTotalTasksSize: vi.fn().mockResolvedValue({ value: 0 }),
}))

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		getTaskHistory: (...a: unknown[]) => rpc.getTaskHistory(...a),
		deleteTasksWithIds: (...a: unknown[]) => rpc.deleteTasksWithIds(...a),
		toggleTaskFavorite: (...a: unknown[]) => rpc.toggleTaskFavorite(...a),
		getTotalTasksSize: (...a: unknown[]) => rpc.getTotalTasksSize(...a),
	},
}))
// GroupedVirtuoso needs a ResizeObserver jsdom does not have; a flat stub keeps this test about
// select mode, not about virtualization internals.
vi.mock("react-virtuoso", () => ({
	GroupedVirtuoso: ({ groupCounts, itemContent }: { groupCounts: number[]; itemContent: (i: number) => React.ReactNode }) => (
		<div>
			{Array.from({ length: groupCounts.reduce((a, b) => a + b, 0) }, (_, i) => (
				<div key={i}>{itemContent(i)}</div>
			))}
		</div>
	),
}))
vi.mock("../HistoryViewItem", () => ({
	default: ({ item }: { item: { id: string; title?: string; task?: string } }) => (
		<div data-testid={`history-item-${item.id}`}>{item.title ?? item.task}</div>
	),
}))

import HistoryView from "../HistoryView"

const tasks = [
	{ id: "a", task: "Debug the NUS characteristic", ts: 3 },
	{ id: "b", task: "Flash the BLG20x demo pair", ts: 2 },
	{ id: "c", task: "Build the LEW840x gateway", ts: 1 },
]

describe("HistoryView — select mode", () => {
	beforeEach(() => {
		state.current.taskHistory = tasks.map((t) => ({ id: t.id, title: undefined }))
		rpc.getTaskHistory.mockReset().mockResolvedValue({ tasks })
		rpc.deleteTasksWithIds.mockClear()
	})

	it("has no red delete button, and no bulk bar, outside select mode", async () => {
		render(<HistoryView onDone={vi.fn()} />)
		await waitFor(() => expect(screen.getByTestId("history-item-a")).toBeInTheDocument())
		expect(screen.queryByTestId("history-select-bar")).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument()
	})

	it("'Select' enters select mode and shows the bar; 'Cancel' leaves it and hides the bar again", async () => {
		render(<HistoryView onDone={vi.fn()} />)
		await waitFor(() => expect(screen.getByTestId("history-item-a")).toBeInTheDocument())

		fireEvent.click(screen.getByRole("button", { name: "Select sessions" }))
		expect(screen.getByTestId("history-select-bar")).toBeInTheDocument()
		expect(screen.getByText("0 selected")).toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: "Cancel selecting" }))
		expect(screen.queryByTestId("history-select-bar")).not.toBeInTheDocument()
	})

	it("the red Delete button names the selected count and starts disabled with nothing selected", async () => {
		render(<HistoryView onDone={vi.fn()} />)
		await waitFor(() => expect(screen.getByTestId("history-item-a")).toBeInTheDocument())
		fireEvent.click(screen.getByRole("button", { name: "Select sessions" }))

		const deleteButton = screen.getByRole("button", { name: "Delete selected sessions" })
		expect(deleteButton).toHaveTextContent("Delete 0")
		expect(deleteButton).toBeDisabled()
	})

	it("never calls window.confirm; deleting goes through an inline Delete N? Yes/No step", async () => {
		const confirmSpy = vi.spyOn(window, "confirm")
		render(<HistoryView onDone={vi.fn()} />)
		await waitFor(() => expect(screen.getByTestId("history-item-a")).toBeInTheDocument())
		fireEvent.click(screen.getByRole("button", { name: "Select sessions" }))
		fireEvent.click(screen.getByRole("button", { name: "Select all" }))

		const deleteButton = screen.getByRole("button", { name: "Delete selected sessions" })
		expect(deleteButton).toHaveTextContent("Delete 3")
		fireEvent.click(deleteButton)

		expect(screen.getByTestId("history-delete-confirm")).toHaveTextContent("Delete 3?")
		expect(confirmSpy).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }))
		expect(rpc.deleteTasksWithIds).toHaveBeenCalledWith(expect.objectContaining({ value: ["a", "b", "c"] }))
	})

	it("'No' on the confirm step cancels without deleting", async () => {
		render(<HistoryView onDone={vi.fn()} />)
		await waitFor(() => expect(screen.getByTestId("history-item-a")).toBeInTheDocument())
		fireEvent.click(screen.getByRole("button", { name: "Select sessions" }))
		fireEvent.click(screen.getByRole("button", { name: "Select all" }))
		fireEvent.click(screen.getByRole("button", { name: "Delete selected sessions" }))
		fireEvent.click(screen.getByRole("button", { name: "Cancel delete" }))
		expect(screen.queryByTestId("history-delete-confirm")).not.toBeInTheDocument()
		expect(rpc.deleteTasksWithIds).not.toHaveBeenCalled()
	})
})
