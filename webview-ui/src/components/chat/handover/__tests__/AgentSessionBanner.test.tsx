import type { HandoverStrip, HandoverUiState } from "@shared/handover"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AgentSessionBanner from "../AgentSessionBanner"

/**
 * The banner exists because the full session view OWNED the panel: with a handover in flight the cards,
 * the sample runs and the history were simply not rendered, and the operator reported "nothing is
 * clickable". A session you are watching must never occupy the surface you work on.
 */

const mockState: { handoverUi?: HandoverUiState } = {}
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => mockState }))
const rpc = vi.hoisted(() => ({ continueHandoverHere: vi.fn(() => Promise.resolve({})) }))
vi.mock("@/services/grpc-client", () => ({ StateServiceClient: rpc }))
vi.mock("@shared/proto/cline/common", () => ({ EmptyRequest: { create: () => ({}) } }))

const ui = (over: Partial<HandoverStrip> = {}): HandoverUiState => ({
	conductor: { active: false, reason: "free tier active" },
	strip: {
		id: "t1",
		phase: "working",
		mission: "Build, flash and debug softAP",
		calls: 12,
		startedAt: new Date().toISOString(),
		pickupPrompt: "Check the Adsum inbox…",
		baseline: { created: true, snapshots: 2 },
		packed: { bits: 12 },
		milestones: [],
		truncated: false,
		liveness: { state: "working", sinceSec: 10 },
		...over,
	},
})

describe("AgentSessionBanner", () => {
	beforeEach(() => {
		mockState.handoverUi = undefined
		vi.clearAllMocks()
	})

	it("reports the agent's state without claiming more than call-recency shows", () => {
		mockState.handoverUi = ui({ liveness: { state: "idle", sinceSec: 300 } })
		render(<AgentSessionBanner onOpen={() => {}} />)
		expect(screen.getByText(/idle — last heard 5 min ago/)).toBeInTheDocument()
	})

	it("surfaces messages the agent has not received", () => {
		mockState.handoverUi = ui({ queued: [{ text: "do you hear me?", ageSec: 400 }] })
		render(<AgentSessionBanner onOpen={() => {}} />)
		expect(screen.getByText(/1 unsent/)).toBeInTheDocument()
	})

	it("opens the full session on demand and can bring it home", () => {
		const onOpen = vi.fn()
		mockState.handoverUi = ui()
		render(<AgentSessionBanner onOpen={onOpen} />)
		fireEvent.click(screen.getByText("View session"))
		expect(onOpen).toHaveBeenCalled()
		fireEvent.click(screen.getByText("Continue here"))
		expect(rpc.continueHandoverHere).toHaveBeenCalled()
	})

	it("renders nothing without a session", () => {
		const { container } = render(<AgentSessionBanner onOpen={() => {}} />)
		expect(container).toBeEmptyDOMElement()
	})
})
