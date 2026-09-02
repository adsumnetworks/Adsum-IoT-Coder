import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { QueuedMessages } from "../QueuedMessages"

/**
 * What a developer sees after typing into a session that is already working.
 *
 * The row exists so the message does not vanish into a queue with nothing on screen to say it was taken —
 * without it the developer cannot tell a queued message from a swallowed one, and says it again.
 */

const mockState: { queuedUserMessages?: any[] } = {}
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => mockState }))

const rpc = vi.hoisted(() => ({ removeQueuedUserMessage: vi.fn(() => Promise.resolve({})) }))
vi.mock("@/services/grpc-client", () => ({ TaskServiceClient: rpc }))
vi.mock("@shared/proto/cline/common", () => ({ StringRequest: { create: (v: any) => v } }))
vi.mock("@/components/common/Thumbnails", () => ({
	default: ({ images, files }: any) => <div data-testid="thumbnails">{[...images, ...files].join(",")}</div>,
}))

const note = (over: Record<string, any> = {}) => ({
	id: "n1",
	ts: 1,
	text: "check the LED",
	source: "composer",
	...over,
})

beforeEach(() => {
	vi.clearAllMocks()
	mockState.queuedUserMessages = []
})

describe("messages waiting for the agent's next step", () => {
	it("shows nothing at all when nothing is waiting", () => {
		const { container } = render(<QueuedMessages queueRefusal={null} />)
		expect(container).toBeEmptyDOMElement()
	})

	it("shows the message, and says when it will go in", () => {
		mockState.queuedUserMessages = [note()]
		render(<QueuedMessages queueRefusal={null} />)
		expect(screen.getByTestId("queued-message")).toBeInTheDocument()
		expect(screen.getByText("check the LED")).toBeInTheDocument()
		expect(screen.getByText(/delivers with the agent's next step/)).toBeInTheDocument()
	})

	it("keeps them in the order they were sent", () => {
		mockState.queuedUserMessages = [note(), note({ id: "n2", text: "and the relay" })]
		render(<QueuedMessages queueRefusal={null} />)
		const rows = screen.getAllByTestId("queued-message")
		expect(rows).toHaveLength(2)
		expect(rows[0]).toHaveTextContent("check the LED")
		expect(rows[1]).toHaveTextContent("and the relay")
	})

	it("can be taken back before it is delivered", () => {
		mockState.queuedUserMessages = [note()]
		render(<QueuedMessages queueRefusal={null} />)
		fireEvent.click(screen.getByLabelText("Remove queued message"))
		expect(rpc.removeQueuedUserMessage).toHaveBeenCalledWith({ value: "n1" })
	})

	/** A driver's note is labelled with who sent it, so it is not mistaken for the developer's own. */
	it("names the driver on a note that came over the seam", () => {
		mockState.queuedUserMessages = [note({ source: "seam", from: "ismail-mac" })]
		render(<QueuedMessages queueRefusal={null} />)
		expect(screen.getByText(/ismail-mac · queued/)).toBeInTheDocument()
	})

	it("carries images and files along with the message", () => {
		mockState.queuedUserMessages = [note({ images: ["data:image/png;base64,AA"], files: ["/tmp/log.txt"] })]
		render(<QueuedMessages queueRefusal={null} />)
		expect(screen.getByTestId("thumbnails")).toHaveTextContent("/tmp/log.txt")
	})
})

describe("when a message could not be queued", () => {
	it("says the queue is full, and that the text is still there", () => {
		render(<QueuedMessages queueRefusal="full" />)
		const refusal = screen.getByTestId("queue-refusal")
		expect(refusal).toHaveTextContent(/already waiting/)
		expect(refusal).toHaveTextContent(/your text is still here/i)
	})

	it("explains an unreachable host without blaming the developer", () => {
		render(<QueuedMessages queueRefusal="unreachable" />)
		expect(screen.getByTestId("queue-refusal")).toHaveTextContent(/still in the box/)
	})

	/** An unrecognised reason must still say something useful rather than rendering an empty line. */
	it("falls back to a usable message for a reason it does not know", () => {
		render(<QueuedMessages queueRefusal="something_new" />)
		expect(screen.getByTestId("queue-refusal")).toHaveTextContent(/still in the box/)
	})

	it("is shown even when nothing is queued, because that is exactly when it happens", () => {
		render(<QueuedMessages queueRefusal="no_task" />)
		expect(screen.getByTestId("queue-refusal")).toBeInTheDocument()
		expect(screen.queryByTestId("queued-message")).toBeNull()
	})
})
