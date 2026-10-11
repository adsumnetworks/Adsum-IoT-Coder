import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * [0.5.1 bench] "All sessions: clicking a session does nothing."
 *
 * The row called showTaskWithId, which loads the session into the sidebar's own controller. In the
 * sessions-first sidebar that chat is never drawn (the sidebar is the rail alone), so nothing appeared.
 * The rail now says where a session opens (a tab); without that the old call stands, for the cockpit.
 */
const rpc = vi.hoisted(() => ({
	showTaskWithId: vi.fn(() => Promise.resolve()),
	getAgentSession: vi.fn(() => Promise.resolve({ value: "" })),
	getTaskHistory: vi.fn(),
}))
const openAgentSession = vi.hoisted(() => vi.fn())

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: { getAgentSession: rpc.getAgentSession },
	TaskServiceClient: {
		showTaskWithId: rpc.showTaskWithId,
		renameTask: vi.fn(() => Promise.resolve()),
		exportTaskWithId: vi.fn(() => Promise.resolve()),
		getTaskHistory: rpc.getTaskHistory,
		deleteTasksWithIds: vi.fn(() => Promise.resolve({})),
		toggleTaskFavorite: vi.fn(() => Promise.resolve({})),
		getTotalTasksSize: vi.fn(() => Promise.resolve({ value: 0 })),
	},
}))
// One object for every render: HistoryView reloads its list when `taskHistory` changes identity.
const state = vi.hoisted(() => ({
	taskHistory: [] as Array<{ id: string; title?: string }>,
	onRelinquishControl: () => () => {},
	environment: "vscode",
	setTotalTasksSize: () => {},
}))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => Object.assign(state, { openAgentSession }),
}))
// GroupedVirtuoso needs a ResizeObserver jsdom does not have: a flat list keeps this about the click.
vi.mock("react-virtuoso", () => ({
	GroupedVirtuoso: ({ groupCounts, itemContent }: { groupCounts: number[]; itemContent: (i: number) => React.ReactNode }) => (
		<div>
			{Array.from({ length: groupCounts.reduce((a, b) => a + b, 0) }, (_, i) => (
				<div key={i}>{itemContent(i)}</div>
			))}
		</div>
	),
}))

import HistoryView from "../HistoryView"
import HistoryViewItem from "../HistoryViewItem"

const item = (over: Record<string, unknown> = {}) =>
	({
		id: "t1",
		ulid: "t1",
		ts: Date.now() - 6e5,
		task: "Debug a real BLE NUS bug",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		size: 0,
		...over,
	}) as any

const drawItem = (it: any, onOpen?: (i: any) => void) =>
	render(
		<HistoryViewItem
			handleDeleteHistoryItem={vi.fn()}
			handleHistorySelect={vi.fn()}
			index={0}
			item={it}
			onOpen={onOpen}
			pendingFavoriteToggles={{}}
			selectedItems={[]}
			toggleFavorite={vi.fn()}
		/>,
	)

beforeEach(() => vi.clearAllMocks())

describe("where a click on a session in the history opens it", () => {
	it("with onOpen (the rail), the click hands the session over and loads nothing into this webview", () => {
		const onOpen = vi.fn()
		drawItem(item(), onOpen)
		fireEvent.click(screen.getByTestId("history-item-title"))
		expect(onOpen).toHaveBeenCalledTimes(1)
		expect(onOpen.mock.calls[0][0]).toMatchObject({ id: "t1" })
		expect(rpc.showTaskWithId).not.toHaveBeenCalled()
	})

	it("without it (the cockpit), the session is shown here, as before", () => {
		drawItem(item())
		fireEvent.click(screen.getByTestId("history-item-title"))
		expect(rpc.showTaskWithId).toHaveBeenCalledTimes(1)
		expect((rpc.showTaskWithId as any).mock.calls[0][0]).toMatchObject({ value: "t1" })
	})

	it("a session worked by an external agent keeps its own read-only view, onOpen or not", async () => {
		const onOpen = vi.fn()
		drawItem(item({ handoverId: "h-7" }), onOpen)
		fireEvent.click(screen.getByTestId("history-item-title"))
		expect(rpc.getAgentSession).toHaveBeenCalledTimes(1)
		await waitFor(() => expect(openAgentSession).toHaveBeenCalled())
		expect(onOpen).not.toHaveBeenCalled()
		expect(rpc.showTaskWithId).not.toHaveBeenCalled()
	})

	it("the pencil, the star and the bin do not open the session", () => {
		const onOpen = vi.fn()
		drawItem(item(), onOpen)
		fireEvent.click(screen.getByTestId("history-item-rename"))
		fireEvent.click(screen.getByLabelText("Add to favorites"))
		fireEvent.click(screen.getByLabelText("Delete"))
		expect(onOpen).not.toHaveBeenCalled()
	})

	it("All sessions passes onOpen down to every row", async () => {
		rpc.getTaskHistory.mockResolvedValue({
			tasks: [
				{ id: "a", task: "Debug the NUS characteristic", ts: Date.now() - 1000 },
				{ id: "b", task: "Flash the BLG20x demo pair", ts: Date.now() - 2000 },
			],
		})
		const onOpen = vi.fn()
		render(<HistoryView onDone={vi.fn()} onOpen={onOpen} />)
		fireEvent.click(await screen.findByText("Flash the BLG20x demo pair"))
		expect(onOpen).toHaveBeenCalledTimes(1)
		expect(onOpen.mock.calls[0][0]).toMatchObject({ id: "b" })
		expect(rpc.showTaskWithId).not.toHaveBeenCalled()
	})
})
