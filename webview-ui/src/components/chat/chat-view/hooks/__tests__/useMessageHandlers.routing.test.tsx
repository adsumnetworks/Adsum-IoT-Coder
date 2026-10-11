import type { ClineMessage } from "@shared/ExtensionMessage"
import { renderHook } from "@testing-library/react"
import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useMessageHandlers } from "../useMessageHandlers"

/**
 * Where a typed message goes.
 *
 * The one that matters is the last group. While the agent is working nothing is awaiting an answer, so a
 * message routed to askResponse would sit in the ask slot until the next ask() — a tool or command
 * approval — returned instantly with it as the answer, approving something the developer never saw. The
 * webview had exactly that branch. It was unreachable only because the composer was disabled in those
 * states, which is the restriction this feature lifts, so the branch had to go in the same change.
 *
 * If a future edit reintroduces it, `askResponse must never be called` is the assertion that fails.
 */

const mockState: { backgroundCommandRunning?: boolean; queuedUserMessages?: any[] } = {}
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => mockState }))

const rpc = vi.hoisted(() => ({
	newTask: vi.fn(() => Promise.resolve({})),
	askResponse: vi.fn(() => Promise.resolve({})),
	queueUserMessage: vi.fn(() => Promise.resolve({ accepted: true, queued: 1, id: "note-1", reason: "" })),
	cancelTask: vi.fn(() => Promise.resolve({})),
	cancelBackgroundCommand: vi.fn(() => Promise.resolve({})),
	clearTask: vi.fn(() => Promise.resolve({})),
}))
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: rpc,
	SlashServiceClient: { condense: vi.fn(), reportBug: vi.fn() },
	FileServiceClient: { openFolder: vi.fn() },
}))
vi.mock("@shared/proto/cline/common", () => ({
	EmptyRequest: { create: (v: any) => v ?? {} },
	StringRequest: { create: (v: any) => v },
}))
vi.mock("@shared/proto/cline/task", () => ({
	AskResponseRequest: { create: (v: any) => v },
	NewTaskRequest: { create: (v: any) => v },
	QueueUserMessageRequest: { create: (v: any) => v },
}))

const say = (over: Partial<ClineMessage> = {}): ClineMessage => ({ type: "say", say: "text", ts: 1, ...over })
const ask = (over: Partial<ClineMessage> = {}): ClineMessage => ({ type: "ask", ask: "followup", ts: 2, ...over })

/** Only the fields handleSendMessage and the cancel path actually read. */
const chatState = (over: Record<string, any> = {}) =>
	({
		setInputValue: vi.fn(),
		activeQuote: null,
		setActiveQuote: vi.fn(),
		setSelectedImages: vi.fn(),
		setSelectedFiles: vi.fn(),
		setSendingDisabled: vi.fn(),
		setEnableButtons: vi.fn(),
		setQueueRefusal: vi.fn(),
		clineAsk: undefined,
		lastMessage: undefined,
		nordicMode: null,
		setNordicMode: vi.fn(),
		setNordicPhase: vi.fn(),
		inputValue: "",
		selectedImages: [],
		selectedFiles: [],
		...over,
	}) as any

const send = async (messages: ClineMessage[], state: any, text = "also check the LED") => {
	const { result } = renderHook(() => useMessageHandlers(messages, state))
	await act(async () => {
		await result.current.handleSendMessage(text, [], [])
	})
	return result
}

beforeEach(() => {
	vi.clearAllMocks()
	mockState.backgroundCommandRunning = false
	mockState.queuedUserMessages = []
})

describe("where a typed message goes", () => {
	it("starts a task when there is no conversation yet", async () => {
		await send([], chatState())
		expect(rpc.newTask).toHaveBeenCalledOnce()
		expect(rpc.queueUserMessage).not.toHaveBeenCalled()
	})

	it("answers the question when one is actually being asked", async () => {
		const question = ask()
		await send([say(), question], chatState({ clineAsk: "followup", lastMessage: question }))
		expect(rpc.askResponse).toHaveBeenCalledOnce()
		expect(rpc.queueUserMessage).not.toHaveBeenCalled()
	})

	describe("while the agent is working", () => {
		it("queues a message sent mid-stream, and never answers an ask with it", async () => {
			const streaming = say({ partial: true })
			await send([say(), streaming], chatState({ lastMessage: streaming }))
			expect(rpc.queueUserMessage).toHaveBeenCalledOnce()
			expect(rpc.askResponse).not.toHaveBeenCalled()
		})

		it("queues a message sent while a request is in flight", async () => {
			const inFlight = say({ say: "api_req_started" })
			await send([say(), inFlight], chatState({ lastMessage: inFlight }))
			expect(rpc.queueUserMessage).toHaveBeenCalledOnce()
			expect(rpc.askResponse).not.toHaveBeenCalled()
		})

		/**
		 * A still-streaming ask has thrown out of ask() before pWaitFor, so nothing is awaiting an answer
		 * yet. Answering it would write the ask slot, be cleared when the ask completed, and vanish.
		 */
		it("queues rather than answers while the question is still arriving", async () => {
			const arriving = ask({ partial: true, ask: "tool" })
			await send([say(), arriving], chatState({ clineAsk: "tool", lastMessage: arriving }))
			expect(rpc.queueUserMessage).toHaveBeenCalledOnce()
			expect(rpc.askResponse).not.toHaveBeenCalled()
		})

		it("clears the box but leaves it usable, so a second message can follow", async () => {
			const state = chatState({ lastMessage: say({ partial: true }) })
			await send([say(), say({ partial: true })], state)
			expect(state.setInputValue).toHaveBeenCalledWith("")
			expect(state.setSendingDisabled).not.toHaveBeenCalled()
			expect(state.setEnableButtons).not.toHaveBeenCalled()
		})
	})

	describe("when the message cannot be queued", () => {
		it("keeps the text and says why, rather than swallowing it", async () => {
			rpc.queueUserMessage.mockResolvedValueOnce({ accepted: false, reason: "full", queued: 5, id: "" } as any)
			const state = chatState({ lastMessage: say({ partial: true }) })
			await send([say(), say({ partial: true })], state)
			expect(state.setQueueRefusal).toHaveBeenCalledWith("full")
			expect(state.setInputValue).not.toHaveBeenCalledWith("")
		})

		/** An older host has no such RPC. The message must not fall back to answering an ask. */
		it("keeps the text when the host does not know the call", async () => {
			rpc.queueUserMessage.mockRejectedValueOnce(new Error("unimplemented"))
			const state = chatState({ lastMessage: say({ partial: true }) })
			await send([say(), say({ partial: true })], state)
			expect(state.setQueueRefusal).toHaveBeenCalledWith("unreachable")
			expect(state.setInputValue).not.toHaveBeenCalledWith("")
			expect(rpc.askResponse).not.toHaveBeenCalled()
		})
	})
})

/**
 * [0.5.1 bench] One prompt started four sessions in nine seconds. `newTask` takes seconds, the box was only
 * cleared once it had returned, and with no task nothing disables sending, so every extra Enter (or a second
 * click on send) in that gap started another session.
 */
describe("one prompt starts one session", () => {
	/** A newTask the test settles by hand, so sends can land while the first is still starting. */
	const pending = () => {
		let resolve!: (v: unknown) => void
		let reject!: (e: unknown) => void
		const promise = new Promise((res, rej) => {
			resolve = res
			reject = rej
		})
		rpc.newTask.mockImplementationOnce(() => promise as any)
		return { resolve, reject }
	}

	it("ignores a second and a third send while the first is still starting", async () => {
		const first = pending()
		const state = chatState({ inputValue: "read the logs" })
		const { result } = renderHook(() => useMessageHandlers([], state))
		let one!: Promise<void>
		await act(async () => {
			one = result.current.handleSendMessage("read the logs", [], [])
			await result.current.handleSendMessage("read the logs", [], [])
			await result.current.handleSendMessage("read the logs", [], [])
		})
		expect(rpc.newTask).toHaveBeenCalledOnce()
		await act(async () => {
			first.resolve({})
			await one
		})
		expect(rpc.newTask).toHaveBeenCalledOnce()
		expect(state.setSendingDisabled).toHaveBeenCalledWith(true)
	})

	it("empties the box as the send starts, not when the host answers", async () => {
		const first = pending()
		const state = chatState({ inputValue: "read the logs", selectedImages: ["a.png"], selectedFiles: ["b.log"] })
		const { result } = renderHook(() => useMessageHandlers([], state))
		let one!: Promise<void>
		await act(async () => {
			one = result.current.handleSendMessage("read the logs", ["a.png"], ["b.log"])
		})
		expect(state.setInputValue).toHaveBeenCalledWith("")
		expect(state.setSelectedImages).toHaveBeenCalledWith([])
		expect(state.setSelectedFiles).toHaveBeenCalledWith([])
		// Once: a second clear when the host answers would take what the developer has typed since.
		await act(async () => {
			first.resolve({})
			await one
		})
		expect(state.setInputValue).toHaveBeenCalledTimes(1)
	})

	it("puts the text, the images and the files back when the session could not start, and the next send works", async () => {
		const first = pending()
		const state = chatState({ inputValue: "read the logs", selectedImages: ["a.png"], selectedFiles: ["b.log"] })
		const { result } = renderHook(() => useMessageHandlers([], state))
		let one!: Promise<void>
		await act(async () => {
			one = result.current.handleSendMessage("read the logs", ["a.png"], ["b.log"])
		})
		await act(async () => {
			first.reject(new Error("host unreachable"))
			await expect(one).rejects.toThrow("host unreachable")
		})
		// The restore is a function of what the box holds now: an empty box gets the draft back...
		const text = state.setInputValue.mock.calls.at(-1)?.[0]
		expect(text("")).toBe("read the logs")
		expect(state.setSelectedImages.mock.calls.at(-1)?.[0]([])).toEqual(["a.png"])
		expect(state.setSelectedFiles.mock.calls.at(-1)?.[0]([])).toEqual(["b.log"])
		// ...and anything typed while the send was starting is kept.
		expect(text("typed meanwhile")).toBe("typed meanwhile")
		// Nothing was sent, so the composer is not put into its "sent" state.
		expect(state.setSendingDisabled).not.toHaveBeenCalled()

		// The guard is down again: the same prompt, sent again, starts the session.
		await act(async () => {
			await result.current.handleSendMessage("read the logs", ["a.png"], ["b.log"])
		})
		expect(rpc.newTask).toHaveBeenCalledTimes(2)
	})

	it("lets a later new session start in the same tab once this one is cleared, even if the first reply never came", async () => {
		pending() // never settled: the reply to the first newTask is lost
		const state = chatState({ inputValue: "read the logs" })
		const { result, rerender } = renderHook(({ messages }) => useMessageHandlers(messages, state), {
			initialProps: { messages: [] as ClineMessage[] },
		})
		await act(async () => {
			void result.current.handleSendMessage("read the logs", [], [])
		})
		expect(rpc.newTask).toHaveBeenCalledOnce()
		// The session shows up through state, then the tab's task is cleared.
		rerender({ messages: [say({ say: "task" })] })
		rerender({ messages: [] })
		await act(async () => {
			await result.current.handleSendMessage("claim it", [], [])
		})
		expect(rpc.newTask).toHaveBeenCalledTimes(2)
	})
})

describe("stopping a run hands back what was not delivered", () => {
	it("returns the developer's own undelivered messages to the box", async () => {
		mockState.queuedUserMessages = [
			{ id: "1", ts: 1, text: "check the LED", source: "composer" },
			{ id: "2", ts: 2, text: "and the relay", source: "composer" },
		]
		const state = chatState({ inputValue: "half typed" })
		const { result } = renderHook(() => useMessageHandlers([say()], state))
		await act(async () => {
			await result.current.executeButtonAction("cancel")
		})

		expect(rpc.cancelTask).toHaveBeenCalledOnce()
		const write = state.setInputValue.mock.calls.at(-1)?.[0]
		expect(typeof write).toBe("function")
		expect(write("half typed")).toBe("half typed\n\ncheck the LED\n\nand the relay")
	})

	/** A note sent over the bench seam belongs to the driver who sent it, not to this text box. */
	it("does not take a driver's note into the developer's box", async () => {
		mockState.queuedUserMessages = [{ id: "1", ts: 1, text: "the antenna is fitted", source: "seam", from: "ismail-mac" }]
		const state = chatState()
		const { result } = renderHook(() => useMessageHandlers([say()], state))
		await act(async () => {
			await result.current.executeButtonAction("cancel")
		})

		expect(rpc.cancelTask).toHaveBeenCalledOnce()
		expect(state.setInputValue).not.toHaveBeenCalled()
	})
})
