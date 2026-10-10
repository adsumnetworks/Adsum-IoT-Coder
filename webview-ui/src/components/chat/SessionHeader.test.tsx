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

	it("cuts a title longer than the tab allows with CSS, not JS — the full name is still the text content", () => {
		const longTask: ClineMessage = { ts: 1, type: "say", say: "task", text: "x".repeat(300) }
		render(<SessionHeader messages={[longTask]} task={longTask} totalCost={0} view="session" />)
		const title = screen.getByTestId("session-header-title")
		expect(title.className).toContain("truncate")
		expect(title).toHaveTextContent("x".repeat(300))
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

	it("shows the journey step banner, on the same meta line as everything else", () => {
		const step: ClineMessage = { ts: 2, type: "say", say: "text", text: "### Step 3/7\n\nWorking on it." }
		render(<SessionHeader messages={[task, step]} task={task} totalCost={0} view="session" />)
		expect(screen.getByTestId("journey-step-banner")).toHaveTextContent("Step 3 of 7")
		expect(screen.getByTestId("journey-step-banner").closest('[data-testid="session-meta"]')).not.toBeNull()
	})

	it("shows 'Adsum free' and tokens on the free tier — never a dollar figure, since the developer paid nothing", () => {
		render(<SessionHeader lastApiReqTotalTokens={48_000} messages={[task]} task={task} totalCost={0.0421} view="session" />)
		expect(screen.getByTestId("model-chip")).toHaveTextContent("Adsum free")
		expect(screen.getByTestId("session-tokens")).toHaveTextContent("48k tokens")
		expect(screen.queryByTestId("session-cost")).not.toBeInTheDocument()
	})

	it("shows the model name, not the provider, and a cost on BYOK once the provider reports one", () => {
		normalizeMock.mockReturnValue({
			selectedProvider: "anthropic",
			selectedModelId: "claude-sonnet-5",
			selectedModelInfo: { contextWindow: 200_000 },
		})
		render(<SessionHeader messages={[task]} task={task} totalCost={1.5} view="session" />)
		expect(screen.getByTestId("model-chip")).toHaveTextContent("claude-sonnet-5")
		expect(screen.getByTestId("model-chip")).not.toHaveTextContent("anthropic")
		expect(screen.getByTestId("session-cost")).toHaveTextContent("$1.5000")
		expect(screen.queryByTestId("session-tokens")).not.toBeInTheDocument()
	})

	it("shows neither tokens nor cost on BYOK when the provider has not reported a cost yet", () => {
		normalizeMock.mockReturnValue({
			selectedProvider: "anthropic",
			selectedModelId: "claude-sonnet-5",
			selectedModelInfo: { contextWindow: 200_000 },
		})
		render(<SessionHeader lastApiReqTotalTokens={48_000} messages={[task]} task={task} totalCost={0} view="session" />)
		expect(screen.queryByTestId("session-cost")).not.toBeInTheDocument()
		expect(screen.queryByTestId("session-tokens")).not.toBeInTheDocument()
	})
})
