import type { HandoverStrip, HandoverUiState } from "@shared/handover"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AgentSessionView from "../AgentSessionView"

const mockState: { handoverUi?: HandoverUiState } = {}
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => mockState }))
vi.mock("@/hooks/useVSCodeTheme", () => ({ useVSCodeTheme: () => ({ isDark: true }) }))
const rpc = vi.hoisted(() => ({
	continueHandoverHere: vi.fn(() => Promise.resolve({})),
	messageHandoverAgent: vi.fn(() => Promise.resolve({})),
	showHandoverWorklog: vi.fn(() => Promise.resolve({})),
}))
vi.mock("@/services/grpc-client", () => ({ StateServiceClient: rpc }))
vi.mock("@shared/proto/cline/common", () => ({
	EmptyRequest: { create: () => ({}) },
	StringRequest: { create: (v: any) => v },
}))

const strip = (over: Partial<HandoverStrip> = {}): HandoverUiState => ({
	conductor: { active: false, reason: "free tier active" },
	strip: {
		id: "t1",
		phase: "working",
		mission: "Test and validate softAP",
		calls: 6,
		startedAt: new Date().toISOString(),
		pickupPrompt: "Check the Adsum inbox and pick up the session (t1).",
		baseline: { created: true, snapshots: 1 },
		packed: { bits: 14, governing: { title: "Test & Validate Workflow", author: "Omar Morceli" } },
		milestones: [
			{
				kind: "bit",
				t: "2026-07-19T10:01:00Z",
				title: "Test & Validate Workflow",
				author: "Omar Morceli",
				version: "1.2.0",
			},
			{ kind: "tool", t: "2026-07-19T10:02:00Z", command: "idf.py --version", exit: 0 },
			{ kind: "step", t: "2026-07-19T10:03:00Z", step: "Step 2: Survey", text: "Survey done — no suite, no board" },
			{ kind: "nudge", t: "2026-07-19T10:03:00Z", text: "nudged: edited source without building" },
		],
		truncated: false,
		liveness: { state: "working", sinceSec: 5 },
		...over,
	},
})

describe("AgentSessionView — the handed-over session as a conversation", () => {
	beforeEach(() => {
		mockState.handoverUi = undefined
		vi.clearAllMocks()
	})

	it("renders nothing when no session is with the agent", () => {
		const { container } = render(<AgentSessionView />)
		expect(container).toBeEmptyDOMElement()
	})

	it("working: mission opens, agent turns carry milestone + credit + nudge, evidence is one click deep", () => {
		mockState.handoverUi = strip()
		render(<AgentSessionView />)
		expect(screen.getAllByText(/Test and validate softAP/).length).toBeGreaterThan(0) // mission bubble (+ header)
		expect(screen.getByText(/Posted to your agent with 14 knowledge bits/)).toBeInTheDocument()
		expect(screen.getByText(/Survey done — no suite, no board/)).toBeInTheDocument()
		expect(screen.getByText("Omar Morceli")).toBeInTheDocument()
		expect(screen.getByText(/edited source without building/)).toBeInTheDocument()
		// evidence collapsed: the command is NOT visible until the worklog line is expanded
		expect(screen.queryByText(/idf\.py --version/)).not.toBeInTheDocument()
		fireEvent.click(screen.getByText(/1 command/))
		expect(screen.getByText(/idf\.py --version/)).toBeInTheDocument()
		expect(screen.getAllByText("seen by Adsum").length).toBeGreaterThan(0)
	})

	it("composer queues a message for the agent's next milestone", () => {
		mockState.handoverUi = strip()
		render(<AgentSessionView />)
		const input = screen.getByPlaceholderText(/lands at its next milestone/)
		fireEvent.change(input, { target: { value: "prefer pytest" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(rpc.messageHandoverAgent).toHaveBeenCalledWith({ value: "prefer pytest" })
	})

	it("a queued message renders as a 'you' turn that says it is queued", () => {
		mockState.handoverUi = strip({
			milestones: [{ kind: "msg", t: "2026-07-19T10:05:00Z", text: "prefer pytest", delivered: false }],
		})
		render(<AgentSessionView />)
		expect(screen.getByText("prefer pytest")).toBeInTheDocument()
		expect(screen.getByText(/queued — delivers at the agent's next milestone/)).toBeInTheDocument()
	})

	it("closed: receipt separates 'it says' from 'measured'; composer hands back to Adsum", () => {
		mockState.handoverUi = strip({
			phase: "closed",
			liveness: { state: "stopped", sinceSec: 900 },
			closedAt: new Date().toISOString(),
			closing: {
				headline: "Suite scaffolded and green",
				itSays: { files: ["test/main/test_sta.c"], nextStep: "run on hardware" },
				adsumSaw: { diffstat: "3 files changed, +214 −9", snapshots: 4, buildsGreen: true },
				standingOn: { authors: ["Omar Morceli"], steward: "Adsum Networks", bits: 2 },
			},
		})
		render(<AgentSessionView />)
		expect(screen.getByText("it says")).toBeInTheDocument()
		expect(screen.getByText("measured")).toBeInTheDocument()
		expect(screen.getByText(/3 files changed/)).toBeInTheDocument()
		expect(screen.getByText(/Session closed cleanly/)).toBeInTheDocument()
		const input = screen.getByPlaceholderText(/Continue this session in Adsum/)
		fireEvent.change(input, { target: { value: "anything" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(rpc.continueHandoverHere).toHaveBeenCalled()
		expect(rpc.messageHandoverAgent).not.toHaveBeenCalled()
	})

	it("says idle rather than claiming Working when the agent has gone quiet", () => {
		mockState.handoverUi = strip({ liveness: { state: "idle", sinceSec: 300 } })
		render(<AgentSessionView />)
		expect(screen.getByText(/idle — last heard 5 min ago/)).toBeInTheDocument()
		expect(screen.queryByText(/working ·/)).not.toBeInTheDocument()
	})

	it("a stopped agent gets no offer to queue — the composer redirects to continuing here", () => {
		mockState.handoverUi = strip({ liveness: { state: "stopped", sinceSec: 1200 } })
		render(<AgentSessionView />)
		const input = screen.getByPlaceholderText(/stopped responding/)
		fireEvent.change(input, { target: { value: "continue" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(rpc.messageHandoverAgent).not.toHaveBeenCalled()
		expect(rpc.continueHandoverHere).toHaveBeenCalled()
	})

	it("is dismissible — the view must never be a trap", () => {
		const onDismiss = vi.fn()
		mockState.handoverUi = strip()
		render(<AgentSessionView onDismiss={onDismiss} />)
		fireEvent.click(screen.getByTitle(/Hide this view and show the cards/))
		expect(onDismiss).toHaveBeenCalled()
	})

	it("never leaks internal vocabulary", () => {
		mockState.handoverUi = strip()
		const { container } = render(<AgentSessionView />)
		const text = container.textContent ?? ""
		for (const word of ["MCP", "ledger", "brief.json", "handover"]) {
			expect(text.toLowerCase()).not.toContain(word.toLowerCase())
		}
		expect(text).toContain("Your coding agent")
	})
})
