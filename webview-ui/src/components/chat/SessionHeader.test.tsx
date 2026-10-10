import type { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { renameTaskMock, normalizeMock } = vi.hoisted(() => ({
	renameTaskMock: vi.fn().mockResolvedValue({}),
	normalizeMock: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: { renameTask: renameTaskMock },
}))
vi.mock("@/components/settings/utils/providerUtils", () => ({
	normalizeApiConfiguration: normalizeMock,
}))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ apiConfiguration: {}, mode: "act" }),
}))

import SessionHeader from "./SessionHeader"

const task: ClineMessage = { ts: 1, type: "say", say: "task", text: "Debug the NUS characteristic" }

describe("SessionHeader", () => {
	beforeEach(() => {
		renameTaskMock.mockClear()
		normalizeMock.mockReset()
		normalizeMock.mockReturnValue({
			selectedProvider: "adsum-free",
			selectedModelId: "adsum-free:free-default",
			selectedModelInfo: { contextWindow: 100_000 },
		})
	})

	it("never renders outside the session view", () => {
		const { container } = render(<SessionHeader messages={[task]} task={task} totalCost={0} view="sidebar" />)
		expect(container).toBeEmptyDOMElement()
	})

	it("shows the title, falling back to the first prompt with no name set", () => {
		render(<SessionHeader messages={[task]} task={task} totalCost={0} view="session" />)
		expect(screen.getByTestId("session-header-title")).toHaveTextContent("Debug the NUS characteristic")
	})

	it("renames through the existing renameTask RPC", () => {
		render(
			<SessionHeader
				currentTaskItem={{
					id: "t1",
					ts: 1,
					task: "Debug the NUS characteristic",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				}}
				messages={[task]}
				task={task}
				totalCost={0}
				view="session"
			/>,
		)
		fireEvent.click(screen.getByTestId("session-header-title"))
		const input = screen.getByTestId("session-header-title-input")
		fireEvent.change(input, { target: { value: "NUS central" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(renameTaskMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", title: "NUS central" }))
	})

	it("shows the journey step banner when the latest assistant text carries a Step heading", () => {
		const step: ClineMessage = { ts: 2, type: "say", say: "text", text: "### Step 3/7\n\nWorking on it." }
		render(<SessionHeader messages={[task, step]} task={task} totalCost={0} view="session" />)
		expect(screen.getByTestId("journey-step-banner")).toHaveTextContent("Step 3 of 7")
	})

	it("shows 'Adsum free' and a cost on the free tier", () => {
		render(<SessionHeader lastApiReqTotalTokens={25_000} messages={[task]} task={task} totalCost={0.0123} view="session" />)
		expect(screen.getByTestId("model-chip")).toHaveTextContent("Adsum free")
		expect(screen.getByTestId("context-use")).toHaveTextContent("25% context")
		expect(screen.getByTestId("session-cost")).toHaveTextContent("$0.0123")
	})

	it("never shows a cost on BYOK, even with a non-zero total", () => {
		normalizeMock.mockReturnValue({
			selectedProvider: "anthropic",
			selectedModelId: "claude-sonnet-5",
			selectedModelInfo: { contextWindow: 200_000 },
		})
		render(<SessionHeader messages={[task]} task={task} totalCost={1.5} view="session" />)
		expect(screen.getByTestId("model-chip")).toHaveTextContent("anthropic · claude-sonnet-5")
		expect(screen.queryByTestId("session-cost")).not.toBeInTheDocument()
	})
})
