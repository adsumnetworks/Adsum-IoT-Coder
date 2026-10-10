import type { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { askResponseMock, updateAutoApproveSettingsMock } = vi.hoisted(() => ({
	askResponseMock: vi.fn().mockResolvedValue({}),
	updateAutoApproveSettingsMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/grpc-client", () => ({ TaskServiceClient: { askResponse: askResponseMock } }))
vi.mock("@/components/chat/auto-approve-menu/AutoApproveSettingsAPI", () => ({
	updateAutoApproveSettings: updateAutoApproveSettingsMock,
}))

const autoApprovalSettings = {
	version: 1,
	enabled: true,
	favorites: [],
	maxRequests: 20,
	actions: {
		readFiles: true,
		editFiles: false,
		executeSafeCommands: true,
		executeAllCommands: false,
		useBrowser: false,
		useMcp: true,
	},
	enableNotifications: false,
}
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ autoApprovalSettings }),
}))

import InlineApprovalRow from "./InlineApprovalRow"

const toolAsk = (toolName: string): ClineMessage => ({
	ts: 1,
	type: "ask",
	ask: "tool",
	text: JSON.stringify({ tool: toolName, path: "src/main.c" }),
})

describe("InlineApprovalRow", () => {
	beforeEach(() => {
		askResponseMock.mockClear()
		updateAutoApproveSettingsMock.mockClear()
	})

	it("renders nothing when the ask is not the one currently awaiting an answer", () => {
		const { container } = render(<InlineApprovalRow isLast={false} message={toolAsk("readFile")} />)
		expect(container).toBeEmptyDOMElement()
	})

	it("renders nothing for an ask outside the approval set, e.g. a question", () => {
		const followup: ClineMessage = { ts: 1, type: "ask", ask: "followup", text: "which board?" }
		const { container } = render(<InlineApprovalRow isLast={true} message={followup} />)
		expect(container).toBeEmptyDOMElement()
	})

	it("renders the three controls for a live tool approval", () => {
		render(<InlineApprovalRow isLast={true} message={toolAsk("readFile")} />)
		expect(screen.getByTestId("inline-approval-allow")).toBeInTheDocument()
		expect(screen.getByTestId("inline-approval-allow-session")).toBeInTheDocument()
		expect(screen.getByTestId("inline-approval-deny")).toBeInTheDocument()
	})

	it("Allow sends yesButtonClicked and touches no settings", () => {
		render(<InlineApprovalRow isLast={true} message={toolAsk("readFile")} />)
		fireEvent.click(screen.getByTestId("inline-approval-allow"))
		expect(askResponseMock).toHaveBeenCalledWith(expect.objectContaining({ responseType: "yesButtonClicked" }))
		expect(updateAutoApproveSettingsMock).not.toHaveBeenCalled()
	})

	it("Allow for this session enables the matching auto-approve action, then approves", () => {
		render(<InlineApprovalRow isLast={true} message={toolAsk("newFileCreated")} />)
		fireEvent.click(screen.getByTestId("inline-approval-allow-session"))
		expect(updateAutoApproveSettingsMock).toHaveBeenCalledWith(
			expect.objectContaining({ actions: expect.objectContaining({ editFiles: true }) }),
		)
		expect(askResponseMock).toHaveBeenCalledWith(expect.objectContaining({ responseType: "yesButtonClicked" }))
	})

	it("Deny sends noButtonClicked", () => {
		render(<InlineApprovalRow isLast={true} message={toolAsk("readFile")} />)
		fireEvent.click(screen.getByTestId("inline-approval-deny"))
		expect(askResponseMock).toHaveBeenCalledWith(expect.objectContaining({ responseType: "noButtonClicked" }))
	})

	it("renders nothing for a still-streaming (partial) ask", () => {
		const { container } = render(<InlineApprovalRow isLast={true} message={{ ...toolAsk("readFile"), partial: true }} />)
		expect(container).toBeEmptyDOMElement()
	})
})
